import { useState } from 'react';
import { Loader2, Sparkles, Upload, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ImageCarousel } from '../ui/ImageCarousel';
import { Feedback } from '../ui/Feedback';
import { ImagePicker } from '../item/ImagePicker';
import { ItemDetailsFields } from '../item/ItemDetailsFields';
import { LocationDateFields } from '../item/LocationDateFields';
import { ReportSuccessPanel } from '../item/ReportSuccessPanel';
import { useFeedback } from '../../hooks/useFeedback';
import { useItemImages } from '../../hooks/useItemImages';
import { useMatchPoll } from '../../hooks/useMatchPoll';
import { analyzeItemImages, enhanceTextDescription } from '../../services/aiService';
import { authPost } from '../../lib/api';
import { MAX_PAYLOAD_BYTES, formatBytes } from '../../lib/imageCompression';
import type { Coordinates } from '../../types/domain';

/** The server requires a usable description for matching. */
const MIN_DESCRIPTION_LENGTH = 10;

type Step = 'upload' | 'analyzing' | 'review' | 'success';

interface ReportItemModalProps {
  type: 'Lost' | 'Found';
  onClose: () => void;
  onSuccess: () => void;
}

interface ReportForm {
  name: string;
  description: string;
  location: string;
  collectionLocation: string;
  date: string;
  time: string;
  tags: string[];
  color: string;
  category: string;
  coordinates?: Coordinates;
  collectionCoordinates?: Coordinates;
}

export function ReportItemModal({ type, onClose, onSuccess }: ReportItemModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [awaitingReview, setAwaitingReview] = useState(false);

  const images = useItemImages();
  const { feedback, showError, clear } = useFeedback();
  const { pending: matchPending, result: matchResult, poll } = useMatchPoll();

  const [form, setForm] = useState<ReportForm>({
    name: '',
    description: '',
    location: '',
    collectionLocation: '',
    date: new Date().toISOString().split('T')[0],
    time: new Date().toTimeString().slice(0, 5),
    tags: [],
    color: '',
    category: '',
  });

  const patch = (values: Partial<ReportForm>) => setForm((prev) => ({ ...prev, ...values }));

  /**
   * Move to the review step, with whatever the model can add.
   *
   * A Lost report with no image takes the text-enhancement path instead, and
   * an enhancement that fails still goes to review: it is a convenience, and
   * losing what the user typed would not be.
   */
  const handleAnalyze = async () => {
    clear();

    if (type === 'Found' && images.files.length === 0) {
      showError('Image is required for Found items');
      return;
    }

    if (!form.location) {
      showError('Please enter a location');
      return;
    }

    if (type === 'Found' && !form.collectionLocation) {
      showError('Please enter a collection location for the found item');
      return;
    }

    const textOnly = type === 'Lost' && images.files.length === 0;

    if (textOnly && (!form.name || !form.description)) {
      showError('Without an image, please provide item name and description');
      return;
    }

    setStep('analyzing');
    setLoading(true);

    try {
      if (textOnly) {
        const enhanced = await enhanceTextDescription(form.name, form.description);

        patch({
          name: enhanced.name,
          description: enhanced.description,
          tags: enhanced.tags,
          color: enhanced.color || '',
        });
      } else {
        // The server picks the provider from the admin setting, so there is
        // nothing to choose here.
        const analysis = await analyzeItemImages(images.files);

        patch({
          name: analysis.name,
          description: analysis.description,
          tags: analysis.tags,
          color: analysis.color || '',
          category: analysis.category || '',
        });
      }

      setStep('review');
    } catch (err) {
      console.error('Error analyzing image:', err);

      if (textOnly) {
        // Continue with the original data if enhancement fails.
        setStep('review');
        return;
      }

      showError(`Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`, {
        sticky: true,
      });
      setStep('upload');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    clear();

    if (!form.name || !form.location) {
      showError('Please fill in required fields');
      return;
    }

    if (form.description.trim().length < MIN_DESCRIPTION_LENGTH) {
      showError(`Please describe the item in at least ${MIN_DESCRIPTION_LENGTH} characters`);
      return;
    }

    if (type === 'Found' && !form.collectionLocation) {
      showError('Please enter a collection location');
      return;
    }

    if (!user?.uid) {
      showError('You must be logged in to report an item');
      return;
    }

    // Last line of defence against a 413. Selection already refuses an image
    // that would push the report over, so this only fires if the text fields
    // are somehow the problem.
    if (images.totalBytes > MAX_PAYLOAD_BYTES) {
      showError(
        `These images total ${formatBytes(images.totalBytes)}, over the ${formatBytes(
          MAX_PAYLOAD_BYTES,
        )} upload limit. Please remove one.`,
      );
      return;
    }

    setLoading(true);

    try {
      const dateTime = new Date(`${form.date}T${form.time}:00`);

      const item: Record<string, unknown> = {
        name: form.name,
        description: form.description,
        type,
        location: form.location,
        date: dateTime.toISOString(),
        tags: form.tags,
        color: form.color,
        category: form.category,
        reporterEmail: user.email || '',
        coordinates: form.coordinates,
      };

      if (type === 'Found' && form.collectionLocation) {
        item.collectionLocation = form.collectionLocation;

        if (form.collectionCoordinates) {
          item.collectionCoordinates = form.collectionCoordinates;
        }
      }

      // The previews are already the compressed data URLs that go up, so there
      // is nothing left to encode here.
      const data = await authPost<{ id: string; matching?: string }>('/api/items', {
        userId: user.uid,
        item,
        images: images.previews,
      });

      setStep('success');

      // `onSuccess` is deliberately not called here: on this screen it clears
      // the report type, which unmounts this modal, so the success step never
      // rendered. It runs when the user dismisses the panel instead.
      //
      // Matching runs after the create response, so the item is persisted
      // before the AI work starts and submission can no longer fail because a
      // provider did. The result is read back from the item itself, but only
      // when the server actually started a run.
      if (data.matching === 'pending') {
        void poll(data.id);
        return;
      }

      setAwaitingReview(true);
    } catch (err) {
      console.error('Error submitting item:', err);
      showError(`Failed to submit: ${err instanceof Error ? err.message : 'Unknown error'}`, {
        sticky: true,
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Close the modal.
   *
   * `onSuccess` moved off the submit path so the success step could render at
   * all, which left the header close as a way to dismiss a filed report
   * without the parent list ever reloading: the item the user just submitted
   * looked like it had vanished.
   */
  const handleClose = () => {
    if (step === 'success') onSuccess();
    onClose();
  };

  const analyseDisabled =
    images.processing ||
    !form.location ||
    (type === 'Found' && (images.files.length === 0 || !form.collectionLocation)) ||
    (type === 'Lost' && images.files.length === 0 && (!form.name || !form.description));

  const accent =
    type === 'Lost' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div
          className={`flex items-center justify-between p-4 border-b border-border flex-shrink-0 ${
            type === 'Lost' ? 'bg-red-50' : 'bg-green-50'
          }`}
        >
          <h2
            className={`text-lg font-semibold ${
              type === 'Lost' ? 'text-red-700' : 'text-green-700'
            }`}
          >
            Report {type} Item
          </h2>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={loading}
            aria-label="Close"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {feedback && step !== 'success' && (
            <Feedback {...feedback} onDismiss={clear} className="mb-4" />
          )}

          {step === 'upload' && (
            <>
              <ImagePicker
                previews={images.previews}
                errors={images.errors}
                processing={images.processing}
                totalBytes={images.totalBytes}
                required={type === 'Found'}
                onAdd={images.add}
                onRemove={images.remove}
              />

              {/* Without an image there is nothing to analyse, so the reporter
                  supplies the name and description the matcher needs. */}
              {type === 'Lost' && images.files.length === 0 && (
                <ManualFields form={form} onChange={patch} />
              )}

              <LocationDateFields type={type} values={form} onChange={patch} />

              <button
                onClick={handleAnalyze}
                disabled={analyseDisabled}
                className={`w-full mt-4 py-4 text-white rounded-xl font-semibold text-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${accent}`}
              >
                <Sparkles className="w-5 h-5" />
                {type === 'Lost' && images.files.length === 0
                  ? 'Continue'
                  : 'Analyze & Generate Details'}
              </button>
            </>
          )}

          {step === 'analyzing' && (
            <div className="py-12 text-center">
              <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-medium text-text-primary mb-2">Analyzing Image...</h3>
              <p className="text-text-secondary">
                AI is identifying the item and extracting details
              </p>
            </div>
          )}

          {step === 'review' && (
            <>
              {images.previews.length > 0 && (
                <div className="mb-6">
                  <ImageCarousel
                    images={images.previews}
                    alt="Item"
                    className="rounded-xl"
                    imageClassName="rounded-xl"
                  />
                </div>
              )}

              <ItemDetailsFields values={form} onChange={patch} />

              <ReportSummary type={type} form={form} />

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('upload')}
                  className="flex-1 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className={`flex-1 py-3 text-white rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${accent}`}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      Submit Report
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === 'success' && (
            <ReportSuccessPanel
              type={type}
              awaitingReview={awaitingReview}
              matchPending={matchPending}
              matchResult={matchResult}
              onDismiss={() => {
                onSuccess();
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const INPUT_CLASS =
  'w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary';

/** Name and description, typed by the reporter when there is no image. */
function ManualFields({
  form,
  onChange,
}: {
  form: ReportForm;
  onChange: (values: Partial<ReportForm>) => void;
}) {
  return (
    <>
      <div className="mb-4">
        <label className="text-sm text-text-secondary mb-1 block font-medium">
          Item Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="What did you lose?"
          className={INPUT_CLASS}
        />
      </div>

      <div className="mb-4">
        <label className="text-sm text-text-secondary mb-1 block font-medium">
          Description <span className="text-red-500">*</span>
        </label>
        <textarea
          value={form.description}
          onChange={(event) => onChange({ description: event.target.value })}
          rows={3}
          placeholder="Describe the item in detail (colour, brand, distinguishing marks)"
          className={`${INPUT_CLASS} resize-none`}
        />
      </div>
    </>
  );
}

/** What the reporter is about to submit, at a glance. */
function ReportSummary({ type, form }: { type: 'Lost' | 'Found'; form: ReportForm }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 mb-6">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-text-secondary">Type</p>
          <p className={`font-medium ${type === 'Lost' ? 'text-red-600' : 'text-green-600'}`}>
            {type}
          </p>
        </div>
        <div>
          <p className="text-text-secondary">Location</p>
          <p className="font-medium text-text-primary truncate">{form.location}</p>
        </div>
        <div>
          <p className="text-text-secondary">Date</p>
          <p className="font-medium text-text-primary">{form.date}</p>
        </div>
        <div>
          <p className="text-text-secondary">Time</p>
          <p className="font-medium text-text-primary">{form.time}</p>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Loader2, Sparkles, Upload, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Feedback } from '../ui/Feedback';
import { ImagePicker } from '../item/ImagePicker';
import { ItemDetailsFields } from '../item/ItemDetailsFields';
import { LocationDateFields } from '../item/LocationDateFields';
import { ReportSuccessPanel } from '../item/ReportSuccessPanel';
import { useFeedback } from '../../hooks/useFeedback';
import { useItemImages } from '../../hooks/useItemImages';
import { useMatchPoll } from '../../hooks/useMatchPoll';
import { analyzeItemImages, isAiAvailable } from '../../services/aiService';
import { authPost } from '../../lib/api';
import { MAX_PAYLOAD_BYTES, formatBytes } from '../../lib/imageCompression';
import type { Coordinates, ItemInput, ItemStatus, ItemType } from '../../types/domain';

/** The server requires a usable description for matching. */
const MIN_DESCRIPTION_LENGTH = 10;

type Step = 'upload' | 'analyzing' | 'review' | 'success';

interface AddItemModalProps {
  onClose: () => void;
  onSuccess: () => void;
  initialData?: Partial<ItemInput>;
  initialType?: ItemType;
}

interface AddItemForm {
  name: string;
  description: string;
  type: ItemType;
  status: ItemStatus;
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

/**
 * Split a Date into the two strings the date and time inputs bind to.
 *
 * Both parts are local. `toISOString()` would give the UTC calendar date next
 * to a local clock time, so an admin east of UTC registering a detection after
 * midnight would file it a full day early, and the item would then be matched
 * against the wrong day.
 */
function toDateParts(value: Date | undefined): { date: string; time: string } {
  const when = value ?? new Date();
  const pad = (part: number) => String(part).padStart(2, '0');

  return {
    date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
    time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
  };
}

export function AddItemModal({ onClose, onSuccess, initialData, initialType }: AddItemModalProps) {
  const { user } = useAuth();
  // A seeded item has already been described by the CCTV flow, so it opens on
  // review rather than asking the admin to upload the crop again.
  const [step, setStep] = useState<Step>(initialData ? 'review' : 'upload');
  const [loading, setLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);

  // A seeded image is real content, not just a preview. CCTV register-as-found
  // hands the detected crop in through `initialData.imageUrl`, and because
  // submission only ever uploaded from picked files, the admin saw the crop on
  // screen and the created item had no images at all.
  const images = useItemImages({ seeded: initialData?.imageUrl ? [initialData.imageUrl] : [] });
  const { feedback, showError, clear } = useFeedback();
  const { pending: matchPending, result: matchResult, poll } = useMatchPoll();

  const [form, setForm] = useState<AddItemForm>(() => ({
    name: initialData?.name || '',
    description: initialData?.description || '',
    type: initialType || 'Found',
    status: 'Pending',
    location: initialData?.location || '',
    collectionLocation: initialData?.collectionPoint || initialData?.collectionLocation || '',
    ...toDateParts(initialData?.date),
    tags: initialData?.tags || [],
    color: initialData?.color || '',
    category: initialData?.category || '',
    coordinates: initialData?.coordinates,
    collectionCoordinates: initialData?.collectionCoordinates,
  }));

  const patch = (values: Partial<AddItemForm>) => setForm((prev) => ({ ...prev, ...values }));

  // Provider keys live on the server, so availability is a server answer.
  useEffect(() => {
    let active = true;

    isAiAvailable().then((available) => {
      if (active) setAiAvailable(available);
    });

    return () => {
      active = false;
    };
  }, []);

  const handleAnalyze = async () => {
    clear();

    if (images.files.length === 0) {
      showError('Please upload an image first');
      return;
    }

    if (!form.location) {
      showError('Please enter a location');
      return;
    }

    setStep('analyzing');
    setLoading(true);

    try {
      // The server picks the provider from the admin setting, so there is
      // nothing to choose here.
      const analysis = await analyzeItemImages(images.files.slice(0, 1));

      patch({
        name: analysis.name,
        description: analysis.description,
        tags: analysis.tags,
        color: analysis.color || '',
        category: analysis.category || '',
      });

      setStep('review');
    } catch (err) {
      console.error('Error analyzing image:', err);
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

    // A Found item needs somewhere for the owner to collect it. The admin path
    // used to skip this, which is how an admin-created found item reached the
    // handover email with no collection point on it.
    if (form.type === 'Found' && !form.collectionLocation) {
      showError('Please enter a collection location for the found item');
      return;
    }

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
      const item: Record<string, unknown> = {
        name: form.name,
        description: form.description,
        type: form.type,
        location: form.location,
        date: new Date(`${form.date}T${form.time}:00`).toISOString(),
        tags: form.tags,
        color: form.color,
        category: form.category,
        coordinates: form.coordinates,
        reporterEmail: user?.email || '',
      };

      if (form.type === 'Found' && form.collectionLocation) {
        item.collectionLocation = form.collectionLocation;

        if (form.collectionCoordinates) {
          item.collectionCoordinates = form.collectionCoordinates;
        }
      }

      // The API is what triggers matching, so creation goes through it. The
      // previews are already the compressed data URLs that go up, seeded crop
      // included.
      const result = await authPost<{ id: string }>('/api/items', {
        item,
        images: images.previews,
      });

      setStep('success');

      // `onSuccess` closes this modal on two of its three mount sites, which
      // unmounts the success step before it renders. It runs on dismissal.
      //
      // Matching runs after the create response, so the score is read back
      // from the item rather than returned inline.
      void poll(result.id);
    } catch (err) {
      console.error('Error adding item:', err);
      showError(`Failed to publish item: ${err instanceof Error ? err.message : 'Unknown error'}`, {
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
   * without the parent list ever reloading.
   */
  const handleClose = () => {
    if (step === 'success') onSuccess();
    onClose();
  };

  const title = {
    upload: 'Add New Item',
    analyzing: 'Analyzing Image...',
    review: 'Review Item Details',
    success: 'Success!',
  }[step];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-medium text-text-primary">{title}</h2>
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
                required
                onAdd={images.add}
                onRemove={images.remove}
              />

              {/* Chosen before the location fields, because a Found item is
                  asked for a collection point and a Lost one is not. */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block font-medium">
                  Report Type
                </label>
                <select
                  value={form.type}
                  onChange={(event) => patch({ type: event.target.value as ItemType })}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="Found">Found</option>
                  <option value="Lost">Lost</option>
                </select>
              </div>

              <LocationDateFields type={form.type} values={form} onChange={patch} />

              {!aiAvailable && (
                <Feedback
                  tone="info"
                  message="No AI provider is configured, so details will not be filled in automatically."
                  className="mb-4"
                />
              )}

              <button
                onClick={handleAnalyze}
                disabled={images.processing || images.files.length === 0 || !form.location}
                className="w-full py-4 bg-primary text-white rounded-xl font-semibold text-lg hover:bg-primary-hover transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                <Sparkles className="w-5 h-5" />
                Analyze &amp; Generate Details
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
                <div className="mb-6 grid grid-cols-3 gap-2">
                  {images.previews.map((preview, index) => (
                    <img
                      key={index}
                      src={preview}
                      alt={`Item ${index + 1}`}
                      className="w-full aspect-square object-cover rounded-lg"
                    />
                  ))}
                </div>
              )}

              <ItemDetailsFields values={form} onChange={patch} />

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">Type</label>
                  <select
                    value={form.type}
                    onChange={(event) => patch({ type: event.target.value as ItemType })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="Found">Found</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">Status</label>
                  <select
                    value={form.status}
                    onChange={(event) => patch({ status: event.target.value as ItemStatus })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Matched">Matched</option>
                    <option value="Claimed">Claimed</option>
                  </select>
                </div>
              </div>

              {/* Editable here too: a seeded item opens straight on this step,
                  so this is the only place its location and time can be set. */}
              <LocationDateFields type={form.type} values={form} onChange={patch} />

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
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-hover transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      Publish Item
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === 'success' && (
            <ReportSuccessPanel
              type={form.type}
              awaitingReview={false}
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

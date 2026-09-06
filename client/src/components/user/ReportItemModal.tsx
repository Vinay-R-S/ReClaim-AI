import { useState, useRef, useEffect } from 'react';
import {
  X,
  Upload,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  MapPin,
  Calendar,
  Clock,
  Camera,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ImageCarousel } from '../ui/ImageCarousel';
import { analyzeItemImages, enhanceTextDescription } from '../../services/aiService';
import { LazyLocationPicker } from '../ui/LazyLocationPicker';
import {
  MAX_PAYLOAD_BYTES,
  compressImage,
  formatBytes,
  isImageFile,
  payloadBytes,
} from '../../lib/imageCompression';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/** Images the server accepts on one item. */
const MAX_IMAGES = 5;

interface ReportItemModalProps {
  type: 'Lost' | 'Found';
  onClose: () => void;
  onSuccess: () => void;
}

export function ReportItemModal({ type, onClose, onSuccess }: ReportItemModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<'upload' | 'analyzing' | 'review' | 'success'>('upload');
  const [matchResult, setMatchResult] = useState<{
    highestScore: number;
    bestMatchId?: string;
  } | null>(null);
  const [matchPending, setMatchPending] = useState(false);
  // The server decides whether matching ran. A user report waits for an admin
  // to approve it first, so there is nothing to poll for and nothing to
  // promise; an admin's own report is approved on write and matches at once.
  const [awaitingReview, setAwaitingReview] = useState(false);
  // Polling outlives a fast dismissal, so state updates are gated on this.
  const mountedRef = useRef(true);

  useEffect(() => {
    // Re-armed on every mount. StrictMode runs mount, cleanup, mount in
    // development, which left the ref false for the component's whole life and
    // made the poll return on its first tick without ever clearing its state.
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [loading, setLoading] = useState(false);
  // Both hold the compressed image, not the original. The picked file is
  // scaled and re-encoded on selection, so analysis and submission send the
  // same small payload and the preview is that payload (defect UI-15).
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imageErrors, setImageErrors] = useState<string[]>([]);
  const [processingImages, setProcessingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    location: '',
    collectionLocation: '', // For Found items only
    date: new Date().toISOString().split('T')[0],
    time: new Date().toTimeString().slice(0, 5),
    tags: [] as string[],
    color: '',
    category: '',
    coordinates: undefined as { lat: number; lng: number } | undefined,
    collectionCoordinates: undefined as { lat: number; lng: number } | undefined,
  });

  // Reporter email from auth
  const reporterEmail = user?.email || '';

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    // A second selection while the first is still being compressed would be
    // built on a stale list and silently lose images.
    if (processingImages) {
      e.target.value = '';
      setImageErrors(['Still preparing the previous images. Please try again in a moment.']);
      return;
    }

    const picked = Array.from(e.target.files);
    // Reset the input up front so the same file can be re-selected after an
    // error, and so it is cleared before any await.
    e.target.value = '';

    const room = MAX_IMAGES - imageFiles.length;
    const errors: string[] = [];

    if (room <= 0) {
      setImageErrors([`You can attach at most ${MAX_IMAGES} images.`]);
      return;
    }

    if (picked.length > room) {
      errors.push(`Only the first ${room} of your ${picked.length} images were added.`);
    }

    setProcessingImages(true);

    const acceptedFiles = [...imageFiles];
    const acceptedPreviews = [...imagePreviews];

    for (const file of picked.slice(0, room)) {
      if (!isImageFile(file)) {
        errors.push(`${file.name}: not an image file.`);
        continue;
      }

      try {
        // Sequential on purpose: decoding several phone photos onto canvases
        // at once is what makes a mobile browser drop the tab.
        const { file: compressed, dataUrl } = await compressImage(file);

        if (payloadBytes([...acceptedPreviews, dataUrl]) > MAX_PAYLOAD_BYTES) {
          errors.push(`${file.name}: skipped, the report would exceed the upload limit.`);
          continue;
        }

        acceptedFiles.push(compressed);
        acceptedPreviews.push(dataUrl);
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'could not be read'}`);
      }
    }

    setImageFiles(acceptedFiles);
    setImagePreviews(acceptedPreviews);
    setImageErrors(errors);
    setProcessingImages(false);
  };

  const handleAnalyze = async () => {
    // For Found: image is mandatory
    if (type === 'Found' && imageFiles.length === 0) {
      alert('Image is required for Found items');
      return;
    }

    if (!formData.location) {
      alert('Please enter a location');
      return;
    }

    // For Found: collection location is mandatory
    if (type === 'Found' && !formData.collectionLocation) {
      alert('Please enter a collection location for the found item');
      return;
    }

    // For Lost without image: use AI to enhance description and generate tags
    if (type === 'Lost' && imageFiles.length === 0) {
      if (!formData.name || !formData.description) {
        alert('Without an image, please provide item name and description');
        return;
      }

      try {
        setStep('analyzing');
        setLoading(true);

        // Use AI to enhance description and generate tags
        const enhanced = await enhanceTextDescription(formData.name, formData.description);

        setFormData((prev) => ({
          ...prev,
          name: enhanced.name,
          description: enhanced.description,
          tags: enhanced.tags,
          color: enhanced.color || '',
        }));

        setStep('review');
      } catch (err) {
        console.error('Text enhancement failed:', err);
        // Continue with original data if enhancement fails
        setStep('review');
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      setStep('analyzing');
      setLoading(true);

      // Analyze image(s) with AI. The server picks the provider from the
      // admin setting, so there is nothing to choose here.
      const analysis = await analyzeItemImages(imageFiles);

      // Update form with AI results
      setFormData((prev) => ({
        ...prev,
        name: analysis.name,
        description: analysis.description,
        tags: analysis.tags,
        color: analysis.color || '',
        category: analysis.category || '',
      }));

      setStep('review');
    } catch (err) {
      console.error('Error analyzing image:', err);
      alert(`Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setStep('upload');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.location) {
      alert('Please fill in required fields');
      return;
    }

    // The server requires a usable description for matching
    if (formData.description.trim().length < 10) {
      alert('Please describe the item in at least 10 characters');
      return;
    }

    // For Found: collection location is mandatory
    if (type === 'Found' && !formData.collectionLocation) {
      alert('Please enter a collection location');
      return;
    }

    if (!user?.uid) {
      alert('You must be logged in to report an item');
      return;
    }

    // Last line of defence against a 413. Selection already refuses an image
    // that would push the report over, so this only fires if the text fields
    // are somehow the problem.
    const size = payloadBytes(imagePreviews);
    if (size > MAX_PAYLOAD_BYTES) {
      alert(
        `These images total ${formatBytes(size)}, over the ${formatBytes(
          MAX_PAYLOAD_BYTES,
        )} upload limit. Please remove one.`,
      );
      return;
    }

    try {
      setLoading(true);

      // The previews are already the compressed data URLs that go up, so there
      // is nothing left to encode here.
      const base64Images = imagePreviews;

      // Create date from form inputs
      const dateTime = new Date(`${formData.date}T${formData.time}:00`);

      // Build item data
      const itemData: Record<string, unknown> = {
        name: formData.name,
        description: formData.description,
        type: type,
        location: formData.location,
        date: dateTime.toISOString(),
        tags: formData.tags,
        color: formData.color,
        category: formData.category,
        reporterEmail: reporterEmail,
        coordinates: formData.coordinates,
      };

      // Add collection location for Found items
      if (type === 'Found' && formData.collectionLocation) {
        itemData.collectionLocation = formData.collectionLocation;
        if (formData.collectionCoordinates) {
          itemData.collectionCoordinates = formData.collectionCoordinates;
        }
      }

      // Get auth token
      const token = await user.getIdToken();

      // Submit to API
      const response = await fetch(`${API_URL}/api/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: user.uid,
          item: itemData,
          images: base64Images,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create item');
      }

      const data = await response.json();
      setStep('success');

      // `onSuccess` is deliberately not called here: on this screen it clears
      // the report type, which unmounts this modal, so the success step never
      // rendered. It runs when the user dismisses the panel instead.

      // Matching now runs after the create response, so the item is persisted
      // before the AI work starts and submission can no longer fail because a
      // provider did. The result is read back from the item itself, but only
      // when the server actually started a run.
      if (data.matching === 'pending') {
        void pollForMatch(data.id);
        return;
      }

      setAwaitingReview(true);
    } catch (err) {
      console.error('Error submitting item:', err);
      alert(`Failed to submit: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Read the match score off the item once matching has had a chance to run.
   *
   * Only `matchScore` counts. `bestCandidateScore` is written precisely when
   * nothing crossed the threshold, so announcing it as a match would be the
   * same lie the server stopped telling.
   *
   * Gives up quietly: a report with no match is the normal case, and matching
   * can outlast this window, so the panel says results may still arrive rather
   * than claiming there are none.
   */
  const pollForMatch = async (itemId: string) => {
    if (!itemId) return;

    setMatchPending(true);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));

      if (!mountedRef.current) return;

      try {
        const response = await fetch(`${API_URL}/api/items/${itemId}`);

        if (!response.ok) continue;

        const { item } = await response.json();

        if (typeof item?.matchScore === 'number' && item.matchScore > 0) {
          if (!mountedRef.current) return;
          setMatchResult({ highestScore: item.matchScore, bestMatchId: item?.matchedItemId });
          break;
        }
      } catch {
        // A failed poll is not a failed report; keep trying, then give up.
      }
    }

    if (mountedRef.current) setMatchPending(false);
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

  const handleTagRemove = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((tag) => tag !== tagToRemove),
    }));
  };

  const handleTagAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const newTag = input.value.trim();
      if (newTag && !formData.tags.includes(newTag)) {
        setFormData((prev) => ({
          ...prev,
          tags: [...prev.tags, newTag],
        }));
        input.value = '';
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        {/* Header */}
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

        {/* Content - Scrollable */}
        <div className="p-6 flex-1 overflow-y-auto">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <>
              {/* Image Upload */}
              <div className="mb-6">
                <label className="text-sm text-text-secondary mb-2 block font-medium">
                  Item Image{imageFiles.length > 1 ? 's' : ''}{' '}
                  {type === 'Found' && <span className="text-red-500">*</span>}
                  {type === 'Lost' && (
                    <span className="text-gray-400 text-xs ml-1">(optional)</span>
                  )}
                  <span className="text-gray-400 text-xs ml-2">
                    (Upload up to 5 images for better analysis)
                  </span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full min-h-[160px] border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-blue-50 transition-all overflow-hidden relative p-4"
                >
                  {imagePreviews.length > 0 ? (
                    <div className="w-full">
                      {/* Image grid */}
                      <div className="grid grid-cols-3 gap-2">
                        {imagePreviews.map((preview, index) => (
                          <div key={index} className="relative aspect-square">
                            <img
                              src={preview}
                              alt={`Preview ${index + 1}`}
                              className="w-full h-full object-cover rounded-lg"
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Remove this image
                                const newFiles = [...imageFiles];
                                const newPreviews = [...imagePreviews];
                                newFiles.splice(index, 1);
                                newPreviews.splice(index, 1);
                                setImageFiles(newFiles);
                                setImagePreviews(newPreviews);
                                setImageErrors([]);
                              }}
                              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                              title="Remove image"
                              aria-label="Remove image"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {/* Add more images slot */}
                        {imagePreviews.length < 5 && (
                          <div className="aspect-square border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50 hover:bg-gray-100">
                            <div className="text-center">
                              <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
                              <span className="text-xs text-gray-500">Add more</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 text-center mt-2">
                        {imagePreviews.length} image
                        {imagePreviews.length > 1 ? 's' : ''} selected (
                        {formatBytes(payloadBytes(imagePreviews))})
                      </p>
                    </div>
                  ) : (
                    <>
                      <ImageIcon className="w-10 h-10 text-text-secondary mb-2" />
                      <p className="text-sm text-text-secondary">
                        {type === 'Found'
                          ? 'Click to upload image(s) (required)'
                          : 'Click to upload image(s) (optional)'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Multiple images help AI analyze better
                      </p>
                    </>
                  )}
                </div>

                {/* Camera Capture Button - Shows on mobile for quick back camera access */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    cameraInputRef.current?.click();
                  }}
                  className="mt-3 w-full py-3 px-4 border-2 border-dashed border-primary/50 rounded-xl flex items-center justify-center gap-2 text-primary hover:bg-primary/5 hover:border-primary transition-all"
                >
                  <Camera className="w-5 h-5" />
                  <span className="text-sm font-medium">Take Photo with Camera</span>
                </button>

                {/* Gallery file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageChange}
                  className="hidden"
                />
                {/* Camera capture input - uses back camera on mobile */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageChange}
                  className="hidden"
                />

                {processingImages && (
                  <p className="mt-2 text-xs text-text-secondary flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Preparing images...
                  </p>
                )}

                {imageErrors.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {imageErrors.map((error, index) => (
                      <li key={index} className="text-xs text-red-600">
                        {error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Manual fields for Lost without image */}
              {type === 'Lost' && imageFiles.length === 0 && (
                <>
                  <div className="mb-4">
                    <label className="text-sm text-text-secondary mb-1 block font-medium">
                      Item Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Blue Backpack, iPhone 15, etc."
                      className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="text-sm text-text-secondary mb-1 block font-medium">
                      Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      placeholder="Describe the item in detail (color, brand, distinguishing features...)"
                      rows={3}
                      className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    />
                  </div>
                </>
              )}

              {/* Location */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block font-medium">
                  <MapPin className="w-4 h-4 inline mr-1" />
                  {type === 'Lost' ? 'Last Seen Location' : 'Found Location'}{' '}
                  <span className="text-red-500">*</span>
                </label>
                <LazyLocationPicker
                  value={formData.location}
                  onChange={(location) => setFormData({ ...formData, location })}
                  onLocationSelect={(location, coordinates) =>
                    setFormData((prev) => ({ ...prev, location, coordinates }))
                  }
                  placeholder={
                    type === 'Lost'
                      ? 'Where did you last see this item?'
                      : 'Where did you find this item?'
                  }
                />
              </div>

              {/* Collection Location - Only for Found */}
              {type === 'Found' && (
                <div className="mb-4">
                  <label className="text-sm text-text-secondary mb-1 block font-medium">
                    <MapPin className="w-4 h-4 inline mr-1" />
                    Collection Location <span className="text-red-500">*</span>
                  </label>
                  <LazyLocationPicker
                    value={formData.collectionLocation}
                    onChange={(location) =>
                      setFormData({ ...formData, collectionLocation: location })
                    }
                    onLocationSelect={(location, collectionCoordinates) =>
                      setFormData((prev) => ({
                        ...prev,
                        collectionLocation: location,
                        collectionCoordinates,
                      }))
                    }
                    placeholder="Where can the owner collect this item?"
                  />
                  <p className="text-xs text-text-secondary mt-1">
                    This will only be shared with the verified owner.
                  </p>
                </div>
              )}

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm text-text-secondary mb-1 block font-medium">
                    <Calendar className="w-4 h-4 inline mr-1" />
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-sm text-text-secondary mb-1 block font-medium">
                    <Clock className="w-4 h-4 inline mr-1" />
                    Time (IST)
                  </label>
                  <input
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Submit/Analyze Button */}
              <button
                onClick={handleAnalyze}
                disabled={
                  processingImages ||
                  !formData.location ||
                  (type === 'Found' && (imageFiles.length === 0 || !formData.collectionLocation)) ||
                  (type === 'Lost' &&
                    imageFiles.length === 0 &&
                    (!formData.name || !formData.description))
                }
                className={`w-full mt-4 py-4 text-white rounded-xl font-semibold text-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
                  type === 'Lost'
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                <Sparkles className="w-5 h-5" />
                {type === 'Lost' && imageFiles.length === 0
                  ? 'Continue'
                  : 'Analyze & Generate Details'}
              </button>
            </>
          )}

          {/* Step 2: Analyzing */}
          {step === 'analyzing' && (
            <div className="py-12 text-center">
              <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-medium text-text-primary mb-2">Analyzing Image...</h3>
              <p className="text-text-secondary">
                AI is identifying the item and extracting details
              </p>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 'review' && (
            <>
              {/* Image Preview Carousel */}
              {imagePreviews.length > 0 && (
                <div className="mb-6">
                  <ImageCarousel
                    images={imagePreviews}
                    alt="Item"
                    className="rounded-xl"
                    imageClassName="rounded-xl"
                  />
                </div>
              )}

              {/* Item Name */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block font-medium">
                  Item Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block font-medium">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              {/* Color */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block font-medium">
                  Primary Color (AI Generated)
                </label>
                <input
                  type="text"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Category */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block font-medium">
                  Category (AI Generated)
                </label>
                <input
                  type="text"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Tags */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-2 block font-medium">Tags</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                    >
                      {tag}
                      <button
                        onClick={() => handleTagRemove(tag)}
                        className="hover:text-red-500"
                        aria-label={`Remove tag ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Add more tags (press Enter)"
                  onKeyDown={handleTagAdd}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>

              {/* Summary Info */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-text-secondary">Type</p>
                    <p
                      className={`font-medium ${
                        type === 'Lost' ? 'text-red-600' : 'text-green-600'
                      }`}
                    >
                      {type}
                    </p>
                  </div>
                  <div>
                    <p className="text-text-secondary">Location</p>
                    <p className="font-medium text-text-primary truncate">{formData.location}</p>
                  </div>
                  <div>
                    <p className="text-text-secondary">Date</p>
                    <p className="font-medium text-text-primary">{formData.date}</p>
                  </div>
                  <div>
                    <p className="text-text-secondary">Time</p>
                    <p className="font-medium text-text-primary">{formData.time}</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
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
                  className={`flex-1 py-3 text-white rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
                    type === 'Lost'
                      ? 'bg-red-500 hover:bg-red-600'
                      : 'bg-green-500 hover:bg-green-600'
                  }`}
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
          {/* Step 4: Success */}
          {step === 'success' && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-bold text-text-primary mb-2">Report Submitted!</h3>
              <p className="text-text-secondary mb-6">
                Your {type.toLowerCase()} item report has been successfully recorded.
              </p>

              {awaitingReview && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-6 text-sm text-amber-700">
                  An admin will review your report shortly. We start looking for matches as soon as
                  it is approved, and anything we find will appear in My Reports.
                </div>
              )}

              {!awaitingReview && matchPending && !matchResult && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm text-blue-700">
                  Checking for matches...
                </div>
              )}

              {!awaitingReview && !matchPending && !matchResult && (
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-6 text-sm text-text-secondary">
                  No match yet. We keep looking, and anything we find will appear in My Reports.
                </div>
              )}

              {matchResult && matchResult.highestScore > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 mb-6">
                  <div className="flex items-center justify-center gap-2 text-blue-700 mb-2">
                    <Sparkles className="w-5 h-5" />
                    <span className="font-semibold text-lg">AI Match Found!</span>
                  </div>
                  <div className="text-4xl font-bold text-blue-600 mb-2">
                    {matchResult.highestScore}%
                  </div>
                  <p className="text-sm text-blue-600">
                    Match confidence score based on your description, location, and details.
                  </p>
                  {matchResult.highestScore >= 75 && (
                    <div className="mt-4 p-2 bg-white/50 rounded-lg text-xs text-blue-800 font-medium">
                      High confidence match detected! You can review details in the matches section.
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-hover transition-colors shadow-md"
              >
                Got it
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

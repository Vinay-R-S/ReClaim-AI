import { useState, useRef, useEffect } from 'react';
import { X, Upload, Image as ImageIcon, Loader2, Sparkles, Camera } from 'lucide-react';
import { uploadItemImage } from '../../services/itemService';
import type { ItemInput } from '../../types/domain';
import { analyzeItemImages, isAiAvailable } from '../../services/aiService';
import { LazyLocationPicker } from '../ui/LazyLocationPicker';
import { authGet, authPost } from '../../lib/api';

interface AddItemModalProps {
  onClose: () => void;
  onSuccess: () => void;
  initialData?: Partial<ItemInput>;
  initialType?: 'Lost' | 'Found';
}

export function AddItemModal({ onClose, onSuccess, initialData, initialType }: AddItemModalProps) {
  const [step, setStep] = useState<'upload' | 'analyzing' | 'review' | 'success'>(
    initialData ? 'review' : 'upload',
  );
  const [matchResult, setMatchResult] = useState<{
    highestScore: number;
  } | null>(null);
  const [matchPending, setMatchPending] = useState(false);
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
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>(
    initialData?.imageUrl ? [initialData.imageUrl] : [],
  );
  // A seeded image is real content, not just a preview. CCTV register-as-found
  // hands the detected crop in through `initialData.imageUrl`, and because
  // submission only ever uploaded from `imageFiles`, the admin saw the crop on
  // screen and the created item had no images at all.
  const [seededImages, setSeededImages] = useState<string[]>(
    initialData?.imageUrl ? [initialData.imageUrl] : [],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [aiAvailable, setAiAvailable] = useState(true);

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

  const [formData, setFormData] = useState<Omit<ItemInput, 'imageUrl'>>({
    name: initialData?.name || '',
    description: initialData?.description || '',
    type: initialType || 'Found',
    location: initialData?.location || '',
    date: initialData?.date || new Date(),
    status: (initialData?.status as any) || 'Pending',
    tags: initialData?.tags || [],
    color: initialData?.color || '',
    category: initialData?.category || '',
    coordinates: initialData?.coordinates,
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setImageFiles(files);
      // A hand-picked upload replaces the seeded crop, matching what the
      // preview strip then shows.
      setSeededImages([]);

      // Generate previews
      const newPreviews: string[] = [];
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          newPreviews.push(reader.result as string);
          if (newPreviews.length === files.length) {
            setImagePreviews([...newPreviews]);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleAnalyze = async () => {
    if (imageFiles.length === 0) {
      alert('Please upload an image first');
      return;
    }

    if (!formData.location) {
      alert('Please enter a location');
      return;
    }

    try {
      setStep('analyzing');
      setLoading(true);

      // Analyze image with AI. The server picks the provider from the admin
      // setting, so there is nothing to choose here.
      const analysis = await analyzeItemImages(imageFiles.slice(0, 1));

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

    try {
      setLoading(true);

      // Seeded images are already base64 and go up as they are; picked files
      // are compressed first.
      const pickedImages =
        imageFiles.length > 0
          ? await Promise.all(imageFiles.map((file) => uploadItemImage(file)))
          : [];
      const uploadedImages = [...seededImages, ...pickedImages];

      // The API is what triggers matching, so creation goes through it.
      const result = await authPost<{ id: string }>('/api/items', {
        item: {
          name: formData.name,
          description: formData.description,
          type: formData.type,
          location: formData.location,
          date: formData.date,
          tags: formData.tags,
          color: formData.color,
          category: formData.category,
          coordinates: formData.coordinates,
        },
        images: uploadedImages,
      });

      setStep('success');

      // `onSuccess` closes this modal on two of its three mount sites, which
      // unmounts the success step before it renders. It runs on dismissal.

      // Matching runs after the create response now, so the score is read back
      // from the item rather than returned inline.
      void pollForMatch(result.id);
    } catch (err) {
      console.error('Error adding item:', err);
      alert(`Failed to publish item: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Read the match score off the item once matching has had a chance to run.
   *
   * Only `matchScore` counts: `bestCandidateScore` is written exactly when
   * nothing crossed the threshold, so it is not a match to report.
   */
  const pollForMatch = async (itemId: string) => {
    if (!itemId) return;

    setMatchPending(true);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));

      if (!mountedRef.current) return;

      try {
        const { item } = await authGet<{ item?: { matchScore?: number } }>(`/api/items/${itemId}`);

        if (typeof item?.matchScore === 'number' && item.matchScore > 0) {
          if (!mountedRef.current) return;
          setMatchResult({ highestScore: item.matchScore });
          break;
        }
      } catch {
        // A failed poll is not a failed publish; keep trying, then give up.
      }
    }

    if (mountedRef.current) setMatchPending(false);
  };

  const handleTagRemove = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags?.filter((tag) => tag !== tagToRemove),
    }));
  };

  const handleTagAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const newTag = input.value.trim();
      if (newTag && !formData.tags?.includes(newTag)) {
        setFormData((prev) => ({
          ...prev,
          tags: [...(prev.tags || []), newTag],
        }));
        input.value = '';
      }
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

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-medium text-text-primary">
            {step === 'upload' && 'Add New Item'}
            {step === 'analyzing' && 'Analyzing Image...'}
            {step === 'review' && 'Review Item Details'}
            {step === 'success' && 'Success!'}
          </h2>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={loading}
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
                <label className="text-sm text-text-secondary mb-2 block">
                  Item Image <span className="text-google-red">*</span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-64 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-blue-50 transition-all overflow-hidden relative"
                >
                  {imagePreviews.length > 0 ? (
                    imagePreviews.length === 1 ? (
                      <img
                        src={imagePreviews[0]}
                        alt="Preview"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full p-2 grid grid-cols-2 gap-2 overflow-y-auto">
                        {imagePreviews.map((preview, idx) => (
                          <img
                            key={idx}
                            src={preview}
                            alt={`Preview ${idx}`}
                            className="w-full h-32 object-cover rounded-lg"
                          />
                        ))}
                      </div>
                    )
                  ) : (
                    <>
                      <ImageIcon className="w-12 h-12 text-text-secondary mb-2" />
                      <p className="text-sm text-text-secondary">Click to upload image</p>
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
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        type: e.target.value as 'Lost' | 'Found',
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="Found">Found</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">Date</label>
                  <input
                    type="date"
                    value={formData.date.toISOString().split('T')[0]}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        date: new Date(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Location */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block">
                  Location <span className="text-google-red">*</span>
                </label>
                <LazyLocationPicker
                  value={formData.location}
                  onChange={(location) => setFormData({ ...formData, location })}
                  onLocationSelect={(location, coordinates) =>
                    setFormData((prev) => ({ ...prev, location, coordinates }))
                  }
                  placeholder="Search for a location..."
                />
              </div>

              {!aiAvailable && (
                <p className="text-sm text-google-red mt-2 text-center">
                  AI analysis is unavailable. Ask an admin to configure a provider key.
                </p>
              )}

              {/* Generate Button */}
              <button
                onClick={handleAnalyze}
                disabled={imageFiles.length === 0}
                className="w-full mt-6 py-4 bg-[#4285F4] text-white rounded-xl font-semibold text-lg hover:bg-[#3367D6] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                <Sparkles className="w-5 h-5" />
                Generate
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
              {/* Image Preview */}
              {imagePreviews.length > 0 && (
                <div className="mb-6">
                  <img
                    src={imagePreviews[0]}
                    alt="Item"
                    className="w-full h-48 object-cover rounded-xl"
                  />
                </div>
              )}

              {/* AI Generated Name */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block">
                  Item Name (AI Generated)
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* AI Generated Description */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block">
                  Description (AI Generated)
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              {/* Tags */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-2 block">
                  Tags (AI Generated)
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                    >
                      {tag}
                      <button
                        onClick={() => handleTagRemove(tag)}
                        className="hover:text-google-red"
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

              {/* Color */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block font-medium">
                  Color (AI Generated)
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
                <label className="text-sm text-text-secondary mb-1 block">
                  Category (AI Generated)
                </label>
                <input
                  type="text"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Type & Status */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        type: e.target.value as 'Lost' | 'Found',
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="Found">Found</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        status: e.target.value as 'Pending' | 'Matched' | 'Claimed',
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Matched">Matched</option>
                    <option value="Claimed">Claimed</option>
                  </select>
                </div>
              </div>

              {/* Location & Date (readonly) */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">Location</label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-text-primary">
                    {formData.location}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">Date</label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-text-primary">
                    {formData.date.toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Actions - Blue with white text */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setStep('upload')}
                  className="flex-1 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      Publish
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {/* Step 4: Success */}
          {step === 'success' && (
            <div className="py-8 text-center px-4">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-bold text-text-primary mb-2">Item Published!</h3>
              <p className="text-text-secondary mb-6 text-sm">
                The {formData.type.toLowerCase()} item has been added to the database.
              </p>

              {matchPending && !matchResult ? (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-6">
                  <p className="text-sm text-blue-700">Checking for matches...</p>
                </div>
              ) : matchResult && matchResult.highestScore > 0 ? (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-6">
                  <div className="flex items-center justify-center gap-2 text-blue-700 mb-2">
                    <Sparkles className="w-4 h-4" />
                    <span className="font-semibold">AI Match Score</span>
                  </div>
                  <div className="text-4xl font-bold text-blue-600 mb-1">
                    {matchResult.highestScore}%
                  </div>
                  <p className="text-xs text-blue-500">
                    Highest similarity found with existing items.
                  </p>
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-5 mb-6">
                  <p className="text-sm text-text-secondary">
                    No match yet. Matching continues in the background.
                  </p>
                </div>
              )}

              <button
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors shadow-md"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

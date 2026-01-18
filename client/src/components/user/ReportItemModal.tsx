import { useState, useRef } from "react";
import {
  X,
  Upload,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  MapPin,
  Calendar,
  Clock,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { ImageCarousel } from "../ui/ImageCarousel";
import {
  analyzeItemImage,
  analyzeMultipleImages,
  enhanceTextDescription,
  getAvailableProviders,
  type AIProvider,
} from "../../services/aiService";
import { LazyLocationPicker } from "../ui/LazyLocationPicker";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface ReportItemModalProps {
  type: "Lost" | "Found";
  onClose: () => void;
  onSuccess: () => void;
}

export function ReportItemModal({
  type,
  onClose,
  onSuccess,
}: ReportItemModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<
    "upload" | "analyzing" | "review" | "success"
  >("upload");
  const [matchResult, setMatchResult] = useState<{
    highestScore: number;
    bestMatchId?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [aiProvider, setAiProvider] = useState<AIProvider>("gemini");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableProviders = getAvailableProviders();

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    location: "",
    collectionLocation: "", // For Found items only
    date: new Date().toISOString().split("T")[0],
    time: new Date().toTimeString().slice(0, 5),
    tags: [] as string[],
    color: "",
    category: "",
    coordinates: undefined as { lat: number; lng: number } | undefined,
    collectionCoordinates: undefined as
      | { lat: number; lng: number }
      | undefined,
  });

  // Reporter email from auth
  const reporterEmail = user?.email || "";

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);

      // Combine with existing files, limit to 5 total
      const combinedFiles = [...imageFiles, ...newFiles].slice(0, 5);
      setImageFiles(combinedFiles);

      // Generate previews for ALL files (rebuild to ensure correct order)
      const previewPromises = combinedFiles.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          }),
      );

      Promise.all(previewPromises).then((previews) => {
        setImagePreviews(previews);
      });

      // Reset input so same file can be re-selected
      e.target.value = "";
    }
  };

  const handleAnalyze = async () => {
    // For Found: image is mandatory
    if (type === "Found" && imageFiles.length === 0) {
      alert("Image is required for Found items");
      return;
    }

    if (!formData.location) {
      alert("Please enter a location");
      return;
    }

    // For Found: collection location is mandatory
    if (type === "Found" && !formData.collectionLocation) {
      alert("Please enter a collection location for the found item");
      return;
    }

    // For Lost without image: use AI to enhance description and generate tags
    if (type === "Lost" && imageFiles.length === 0) {
      if (!formData.name || !formData.description) {
        alert("Without an image, please provide item name and description");
        return;
      }

      try {
        setStep("analyzing");
        setLoading(true);

        // Use AI to enhance description and generate tags
        const enhanced = await enhanceTextDescription(
          formData.name,
          formData.description,
          aiProvider,
        );

        setFormData((prev) => ({
          ...prev,
          name: enhanced.name,
          description: enhanced.description,
          tags: enhanced.tags,
          color: enhanced.color || "",
        }));

        setStep("review");
      } catch (err) {
        console.error("Text enhancement failed:", err);
        // Continue with original data if enhancement fails
        setStep("review");
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      setStep("analyzing");
      setLoading(true);

      // Analyze image(s) with AI - use multi-image if more than one
      const analysis =
        imageFiles.length > 1
          ? await analyzeMultipleImages(imageFiles, "groq")
          : await analyzeItemImage(imageFiles[0], aiProvider);

      // Update form with AI results
      setFormData((prev) => ({
        ...prev,
        name: analysis.name,
        description: analysis.description,
        tags: analysis.tags,
        color: analysis.color || "",
        category: analysis.category || "",
      }));

      setStep("review");
    } catch (err) {
      console.error("Error analyzing image:", err);
      alert(
        `Analysis failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.location) {
      alert("Please fill in required fields");
      return;
    }

    // For Found: collection location is mandatory
    if (type === "Found" && !formData.collectionLocation) {
      alert("Please enter a collection location");
      return;
    }

    if (!user?.uid) {
      alert("You must be logged in to report an item");
      return;
    }

    try {
      setLoading(true);

      // Convert images to base64
      const base64Images: string[] = [];
      for (const file of imageFiles) {
        const base64 = await fileToBase64(file);
        base64Images.push(base64);
      }

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
      if (type === "Found" && formData.collectionLocation) {
        itemData.collectionLocation = formData.collectionLocation;
        if (formData.collectionCoordinates) {
          itemData.collectionCoordinates = formData.collectionCoordinates;
        }
      }

      // Get auth token
      const token = await user.getIdToken();

      // Submit to API
      const response = await fetch(`${API_URL}/api/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
        throw new Error(errorData.error || "Failed to create item");
      }

      const data = await response.json();
      setMatchResult(data.matchResult);
      setStep("success");
      onSuccess();
    } catch (err) {
      console.error("Error submitting item:", err);
      alert(
        `Failed to submit: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    } finally {
      setLoading(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleTagRemove = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((tag) => tag !== tagToRemove),
    }));
  };

  const handleTagAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const newTag = input.value.trim();
      if (newTag && !formData.tags.includes(newTag)) {
        setFormData((prev) => ({
          ...prev,
          tags: [...prev.tags, newTag],
        }));
        input.value = "";
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div
          className={`flex items-center justify-between p-4 border-b border-border flex-shrink-0 ${
            type === "Lost" ? "bg-red-50" : "bg-green-50"
          }`}
        >
          <h2
            className={`text-lg font-semibold ${
              type === "Lost" ? "text-red-700" : "text-green-700"
            }`}
          >
            Report {type} Item
          </h2>
          <button
            onClick={onClose}
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
          {step === "upload" && (
            <>
              {/* Image Upload */}
              <div className="mb-6">
                <label className="text-sm text-text-secondary mb-2 block font-medium">
                  Item Image{imageFiles.length > 1 ? "s" : ""}{" "}
                  {type === "Found" && <span className="text-red-500">*</span>}
                  {type === "Lost" && (
                    <span className="text-gray-400 text-xs ml-1">
                      (optional)
                    </span>
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
                              <span className="text-xs text-gray-500">
                                Add more
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 text-center mt-2">
                        {imagePreviews.length} image
                        {imagePreviews.length > 1 ? "s" : ""} selected
                      </p>
                    </div>
                  ) : (
                    <>
                      <ImageIcon className="w-10 h-10 text-text-secondary mb-2" />
                      <p className="text-sm text-text-secondary">
                        {type === "Found"
                          ? "Click to upload image(s) (required)"
                          : "Click to upload image(s) (optional)"}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Multiple images help AI analyze better
                      </p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>

              {/* Manual fields for Lost without image */}
              {type === "Lost" && imageFiles.length === 0 && (
                <>
                  <div className="mb-4">
                    <label className="text-sm text-text-secondary mb-1 block font-medium">
                      Item Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
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
                  {type === "Lost"
                    ? "Last Seen Location"
                    : "Found Location"}{" "}
                  <span className="text-red-500">*</span>
                </label>
                <LazyLocationPicker
                  value={formData.location}
                  onChange={(location) =>
                    setFormData({ ...formData, location })
                  }
                  onLocationSelect={(location, coordinates) =>
                    setFormData((prev) => ({ ...prev, location, coordinates }))
                  }
                  placeholder={
                    type === "Lost"
                      ? "Where did you last see this item?"
                      : "Where did you find this item?"
                  }
                />
              </div>

              {/* Collection Location - Only for Found */}
              {type === "Found" && (
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
                    onChange={(e) =>
                      setFormData({ ...formData, date: e.target.value })
                    }
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
                    onChange={(e) =>
                      setFormData({ ...formData, time: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* AI Provider Selection */}
              {availableProviders.length > 0 && (
                <div className="mb-6">
                  <label className="text-sm text-text-secondary mb-2 block font-medium">
                    AI Provider
                  </label>
                  <div className="flex gap-2">
                    {availableProviders.includes("gemini") && (
                      <button
                        type="button"
                        onClick={() => setAiProvider("gemini")}
                        className={`flex-1 py-2 px-4 rounded-lg border transition-colors ${
                          aiProvider === "gemini"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-gray-50"
                        }`}
                      >
                        Gemini
                      </button>
                    )}
                    {availableProviders.includes("groq") && (
                      <button
                        type="button"
                        onClick={() => setAiProvider("groq")}
                        className={`flex-1 py-2 px-4 rounded-lg border transition-colors ${
                          aiProvider === "groq"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-gray-50"
                        }`}
                      >
                        Groq
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Submit/Analyze Button */}
              <button
                onClick={handleAnalyze}
                disabled={
                  !formData.location ||
                  (type === "Found" &&
                    (imageFiles.length === 0 ||
                      !formData.collectionLocation)) ||
                  (type === "Lost" &&
                    imageFiles.length === 0 &&
                    (!formData.name || !formData.description))
                }
                className={`w-full mt-4 py-4 text-white rounded-xl font-semibold text-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
                  type === "Lost"
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-green-500 hover:bg-green-600"
                }`}
              >
                <Sparkles className="w-5 h-5" />
                {type === "Lost" && imageFiles.length === 0
                  ? "Continue"
                  : "Analyze & Generate Details"}
              </button>
            </>
          )}

          {/* Step 2: Analyzing */}
          {step === "analyzing" && (
            <div className="py-12 text-center">
              <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-medium text-text-primary mb-2">
                Analyzing Image...
              </h3>
              <p className="text-text-secondary">
                AI is identifying the item and extracting details
              </p>
            </div>
          )}

          {/* Step 3: Review */}
          {step === "review" && (
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
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
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
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
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
                  onChange={(e) =>
                    setFormData({ ...formData, color: e.target.value })
                  }
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
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Tags */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-2 block font-medium">
                  Tags
                </label>
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
                        type === "Lost" ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {type}
                    </p>
                  </div>
                  <div>
                    <p className="text-text-secondary">Location</p>
                    <p className="font-medium text-text-primary truncate">
                      {formData.location}
                    </p>
                  </div>
                  <div>
                    <p className="text-text-secondary">Date</p>
                    <p className="font-medium text-text-primary">
                      {formData.date}
                    </p>
                  </div>
                  <div>
                    <p className="text-text-secondary">Time</p>
                    <p className="font-medium text-text-primary">
                      {formData.time}
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep("upload")}
                  className="flex-1 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className={`flex-1 py-3 text-white rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
                    type === "Lost"
                      ? "bg-red-500 hover:bg-red-600"
                      : "bg-green-500 hover:bg-green-600"
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
          {step === "success" && (
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-bold text-text-primary mb-2">
                Report Submitted!
              </h3>
              <p className="text-text-secondary mb-6">
                Your {type.toLowerCase()} item report has been successfully
                recorded.
              </p>

              {matchResult && matchResult.highestScore > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 mb-6">
                  <div className="flex items-center justify-center gap-2 text-blue-700 mb-2">
                    <Sparkles className="w-5 h-5" />
                    <span className="font-semibold text-lg">
                      AI Match Found!
                    </span>
                  </div>
                  <div className="text-4xl font-bold text-blue-600 mb-2">
                    {matchResult.highestScore}%
                  </div>
                  <p className="text-sm text-blue-600">
                    Match confidence score based on your description, location,
                    and details.
                  </p>
                  {matchResult.highestScore >= 75 && (
                    <div className="mt-4 p-2 bg-white/50 rounded-lg text-xs text-blue-800 font-medium">
                      High confidence match detected! You can review details in
                      the matches section.
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={onClose}
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

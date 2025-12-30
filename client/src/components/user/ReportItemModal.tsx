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
import {
  analyzeItemImage,
  getAvailableProviders,
  type AIProvider,
} from "../../services/aiService";
import { LocationPicker } from "../ui/LocationPicker";

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
  const [step, setStep] = useState<"upload" | "analyzing" | "review">("upload");
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
    date: new Date().toISOString().split("T")[0],
    time: new Date().toTimeString().slice(0, 5),
    tags: [] as string[],
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setImageFiles(files);

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
      alert("Please upload an image first");
      return;
    }

    if (!formData.location) {
      alert("Please enter a location");
      return;
    }

    try {
      setStep("analyzing");
      setLoading(true);

      // Analyze image with AI
      const analysis = await analyzeItemImage(imageFiles[0], aiProvider);

      // Update form with AI results
      setFormData((prev) => ({
        ...prev,
        name: analysis.name,
        description: analysis.description,
        tags: analysis.tags,
      }));

      setStep("review");
    } catch (err) {
      console.error("Error analyzing image:", err);
      alert(
        `Analysis failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
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

      // Submit to API
      const response = await fetch(`${API_URL}/api/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.uid,
          item: {
            name: formData.name,
            description: formData.description,
            type: type,
            location: formData.location,
            date: dateTime.toISOString(),
            tags: formData.tags,
          },
          images: base64Images,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create item");
      }

      onSuccess();
      onClose();
    } catch (err) {
      console.error("Error submitting item:", err);
      alert(
        `Failed to submit: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
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
                  Item Image <span className="text-red-500">*</span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-48 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-blue-50 transition-all overflow-hidden relative"
                >
                  {imagePreviews.length > 0 ? (
                    <img
                      src={imagePreviews[0]}
                      alt="Preview"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <>
                      <ImageIcon className="w-12 h-12 text-text-secondary mb-2" />
                      <p className="text-sm text-text-secondary">
                        Click to upload image
                      </p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>

              {/* Location */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block font-medium">
                  <MapPin className="w-4 h-4 inline mr-1" />
                  Location <span className="text-red-500">*</span>
                </label>
                <LocationPicker
                  value={formData.location}
                  onChange={(location) =>
                    setFormData({ ...formData, location })
                  }
                  placeholder="Where did you lose/find this item?"
                />
              </div>

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

              {/* Generate Button */}
              <button
                onClick={handleAnalyze}
                disabled={imageFiles.length === 0 || !formData.location}
                className={`w-full mt-4 py-4 text-white rounded-xl font-semibold text-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
                  type === "Lost"
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-green-500 hover:bg-green-600"
                }`}
              >
                <Sparkles className="w-5 h-5" />
                Analyze & Generate Details
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
        </div>
      </div>
    </div>
  );
}

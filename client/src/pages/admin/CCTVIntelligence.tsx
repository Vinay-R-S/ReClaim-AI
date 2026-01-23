import { useState, useRef, useEffect, useCallback } from "react";
import {
  Camera,
  Upload,
  Target,
  AlertTriangle,
  Video,
  Plus,
  RefreshCw,
  Clock,
  CheckCircle,
  Sparkles,
  Loader2,
} from "../../lib/icons";
import {
  detectObjectsInFrame,
  captureFrame,
  extractFramesFromVideo,
  analyzeVideoForItem,
  describeItemImage,
  getYoloClasses,
  type Detection,
  type VideoAnalysisResult,
  type Keyframe,
} from "../../services/cctvService";
import { AddItemModal } from "../../components/admin/AddItemModal";

export function CCTVIntelligence() {
  const [activeTab, setActiveTab] = useState<"live" | "upload">("live");
  const [yoloClasses, setYoloClasses] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [bestDetection, setBestDetection] = useState<Detection | null>(null); // Stable highest confidence
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);

  // Webcam refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Video Upload State
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const uploadVideoRef = useRef<HTMLVideoElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResult, setAnalysisResult] =
    useState<VideoAnalysisResult | null>(null);
  const [selectedKeyframe, setSelectedKeyframe] = useState<Keyframe | null>(
    null,
  );

  // Register Found Workflow
  const [showAddModal, setShowAddModal] = useState(false);
  const [foundItemData, setFoundItemData] = useState<any>(null);

  // 1. Fetch YOLO Classes for dropdown
  useEffect(() => {
    getYoloClasses()
      .then((classes) => setYoloClasses(classes))
      .catch((err) => console.error("Failed to fetch YOLO classes:", err));
  }, []);

  // 2. Webcam Handling
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }
    } catch (err) {
      console.error("Webcam error:", err);
    }
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    if (activeTab === "live") {
      startWebcam();
    } else {
      stopWebcam();
    }
    return () => stopWebcam();
  }, [activeTab]);

  // 3. Auto Detection (every 4 seconds) with stable confidence
  const runDetection = useCallback(async () => {
    if (!videoRef.current || isProcessing) return;

    try {
      setIsProcessing(true);
      const frameBase64 = captureFrame(videoRef.current);
      // Pass selectedCategory to filter detections on server side
      const results = await detectObjectsInFrame(
        frameBase64,
        undefined,
        selectedCategory || undefined,
      );

      // Stable detection: only update if we find a higher confidence detection
      if (results.detections.length > 0) {
        // Find the highest confidence detection from this scan
        const newBest = results.detections.reduce((prev, curr) =>
          curr.confidence > prev.confidence ? curr : prev,
        );

        // Only update bestDetection if this one is better
        setBestDetection((prevBest) => {
          if (!prevBest || newBest.confidence > prevBest.confidence) {
            return newBest;
          }
          return prevBest;
        });

        setDetections(results.detections);
        drawDetections(results.detections);
      }
      setLastScanTime(new Date());
    } catch (err) {
      console.error("Detection failed:", err);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, selectedCategory]);

  // Auto-scan every 4 seconds when live tab is active
  useEffect(() => {
    if (activeTab === "live") {
      // Initial delay for camera to initialize
      const initialTimer = setTimeout(() => {
        runDetection();
      }, 2000);

      // Set up interval for continuous scanning
      intervalRef.current = setInterval(() => {
        runDetection();
      }, 4000); // Scan every 4 seconds

      return () => {
        clearTimeout(initialTimer);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [activeTab, runDetection]);

  // 4. Drawing Bounding Boxes
  const drawDetections = (currentDetections: Detection[]) => {
    if (!canvasRef.current || !videoRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;

    currentDetections.forEach((det) => {
      const [x1, y1, x2, y2] = det.bbox;
      const width = x2 - x1;
      const height = y2 - y1;

      // All shown detections are matches since filtering is done server-side
      const isMatch = Boolean(selectedCategory);

      ctx.strokeStyle = isMatch ? "#22c55e" : "#ef4444";
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, width, height);

      ctx.fillStyle = isMatch ? "#22c55e" : "#ef4444";
      ctx.fillRect(x1, y1 - 25, width, 25);

      ctx.fillStyle = "#ffffff";
      ctx.font = "16px sans-serif";
      ctx.fillText(
        `${det.className} ${Math.round(det.confidence * 100)}%`,
        x1 + 5,
        y1 - 5,
      );
    });
  };

  // 5. Register Found Item Logic with AI Description
  const [isDescribing, setIsDescribing] = useState(false);

  const handleRegisterFound = async (det: Detection) => {
    if (!det.croppedImage) return;

    setIsDescribing(true);
    try {
      // Call Groq AI to get detailed description
      const aiDescription = await describeItemImage(
        det.croppedImage,
        det.className,
      );

      setFoundItemData({
        name: aiDescription.name || `Found ${det.className}`,
        description:
          aiDescription.description ||
          `Detected via CCTV Intelligence. Object identified as ${det.className}.`,
        category: aiDescription.category || det.className,
        tags: aiDescription.tags || [det.className.toLowerCase()],
        color: aiDescription.color || "Unknown",
        imageUrl: det.croppedImage,
        location: "Admin Office (CCTV)",
      });
    } catch (err) {
      console.error("AI description failed:", err);
      // Fallback to basic data
      setFoundItemData({
        name: `Found ${det.className}`,
        description: `Detected via CCTV Intelligence. Object identified as ${det.className}.`,
        category: det.className,
        imageUrl: det.croppedImage,
        location: "Admin Office (CCTV)",
      });
    } finally {
      setIsDescribing(false);
    }

    setShowAddModal(true);
  };

  const handleRegisterFromKeyframe = (keyframe: Keyframe) => {
    const bestDet = keyframe.detections[0];
    if (!bestDet) return;

    setFoundItemData({
      name: `Found ${bestDet.className}`,
      description: `Detected via CCTV Video Analysis at ${keyframe.timestamp}s. ${analysisResult?.aiAnalysis?.explanation || ""}`,
      category: bestDet.className,
      imageUrl: bestDet.croppedImage || keyframe.frameImage,
      location: "Admin Office (CCTV)",
    });

    setShowAddModal(true);
  };

  // 6. File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setVideoPreview(URL.createObjectURL(file));
      setAnalysisResult(null);
      setSelectedKeyframe(null);
    }
  };

  // 7. Video Analysis
  const handleAnalyzeVideo = async () => {
    if (!uploadVideoRef.current || !selectedCategory) {
      alert("Please select a category to search for");
      return;
    }

    try {
      setIsAnalyzing(true);
      setAnalysisProgress(10);

      // Extract frames from video at 5-second intervals
      const frames = await extractFramesFromVideo(uploadVideoRef.current, 5);
      setAnalysisProgress(40);

      if (frames.length === 0) {
        throw new Error("Could not extract frames from video");
      }

      // Analyze frames with selected category
      const result = await analyzeVideoForItem(
        frames,
        selectedCategory,
        selectedCategory,
        `Looking for ${selectedCategory} in video footage`,
      );

      setAnalysisProgress(100);
      setAnalysisResult(result);

      if (result.keyframes.length > 0) {
        setSelectedKeyframe(result.keyframes[0]);
      }
    } catch (err) {
      console.error("Video analysis failed:", err);
      alert(
        `Analysis failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
    }
  };

  // Format timestamp
  const formatTimestamp = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Get confidence color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "bg-green-500";
    if (confidence >= 0.6) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Video className="w-8 h-8 text-primary" />
            CCTV Intelligence
          </h1>
          <p className="text-text-secondary mt-1">
            Real-time object detection for lost item recovery
          </p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel: Controls */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6">
          {/* Target Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Target className="w-4 h-4" /> Target Category
              {activeTab === "upload" && (
                <span className="text-red-500">*</span>
              )}
            </label>
            <select
              className="w-full p-2 border rounded-lg text-sm capitalize"
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                // Reset bestDetection when category changes
                setBestDetection(null);
                setDetections([]);
              }}
            >
              <option value="">-- Select Category --</option>
              {yoloClasses.map((cls) => (
                <option key={cls} value={cls} className="capitalize">
                  {cls}
                </option>
              ))}
            </select>

            {selectedCategory && (
              <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-700">
                <strong>Searching for:</strong>{" "}
                <span className="capitalize">{selectedCategory}</span>
                <p className="mt-1 text-blue-600">
                  Bounding boxes will only appear for this category
                </p>
              </div>
            )}
          </div>

          <hr />

          {/* Live Detection Panel (Static Mode) */}
          {activeTab === "live" && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium text-text-primary">
                  Detection Results
                </h3>
                <button
                  onClick={runDetection}
                  disabled={isProcessing}
                  className="text-xs flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded transition-colors disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${isProcessing ? "animate-spin" : ""}`}
                  />
                  Scan
                </button>
              </div>

              {lastScanTime && (
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Last scan: {lastScanTime.toLocaleTimeString()}
                </p>
              )}

              {/* Best Detection - Stable Highest Confidence */}
              {bestDetection && (
                <div className="bg-green-50 border-2 border-green-200 p-4 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-green-800 capitalize">
                      Best: {bestDetection.className}
                    </span>
                    <span className="text-lg font-bold text-green-600">
                      {Math.round(bestDetection.confidence * 100)}%
                    </span>
                  </div>
                  {bestDetection.croppedImage && (
                    <img
                      src={bestDetection.croppedImage}
                      alt={bestDetection.className}
                      className="w-full h-24 object-contain rounded mb-2 bg-white"
                    />
                  )}
                  <button
                    onClick={() => handleRegisterFound(bestDetection)}
                    disabled={isDescribing}
                    className="w-full text-sm flex items-center justify-center gap-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {isDescribing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />{" "}
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" /> Register as Found
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="max-h-[200px] overflow-y-auto space-y-2">
                {detections.length === 0 && !bestDetection && (
                  <p className="text-xs text-gray-400 italic py-4 text-center">
                    {selectedCategory
                      ? "Auto-scanning for " + selectedCategory + "..."
                      : "Select a category to start scanning"}
                  </p>
                )}

                {detections.map((det, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col bg-gray-50 p-3 rounded-lg border border-gray-100"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium capitalize text-text-primary">
                        {det.className}
                      </span>
                      <span
                        className={`text-xs text-white px-2 py-1 rounded-full ${getConfidenceColor(det.confidence)}`}
                      >
                        {Math.round(det.confidence * 100)}%
                      </span>
                    </div>

                    <button
                      onClick={() => handleRegisterFound(det)}
                      disabled={isDescribing}
                      className="text-xs flex items-center justify-center gap-1 bg-primary text-white py-1.5 rounded hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {isDescribing ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />{" "}
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" /> Register as Found
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Video Analysis Results */}
          {activeTab === "upload" && analysisResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <h3 className="text-sm font-medium text-text-primary">
                  Analysis Complete
                </h3>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 p-2 rounded">
                  <p className="text-gray-500">Frames Analyzed</p>
                  <p className="font-bold text-lg">
                    {analysisResult.stats.totalFramesAnalyzed}
                  </p>
                </div>
                <div className="bg-gray-50 p-2 rounded">
                  <p className="text-gray-500">Keyframes Found</p>
                  <p className="font-bold text-lg text-green-600">
                    {analysisResult.stats.framesWithTarget}
                  </p>
                </div>
              </div>

              {/* Keyframes Gallery */}
              {analysisResult.keyframes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-gray-500">
                    Keyframes
                  </h4>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {analysisResult.keyframes.slice(0, 6).map((kf, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedKeyframe(kf)}
                        className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                          selectedKeyframe === kf
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-gray-200"
                        }`}
                      >
                        <img
                          src={kf.frameImage}
                          alt={`Keyframe ${formatTimestamp(kf.timestamp)}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center">
                          {formatTimestamp(kf.timestamp)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Register Button */}
              {selectedKeyframe && (
                <button
                  onClick={() => handleRegisterFromKeyframe(selectedKeyframe)}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Register as Found
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Panel: Video Feed */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tabs */}
          <div className="flex gap-4 border-b border-gray-200">
            <button
              onClick={() => setActiveTab("live")}
              className={`pb-2 text-sm font-medium transition-colors ${activeTab === "live" ? "border-b-2 border-primary text-primary" : "text-gray-500"}`}
            >
              <Camera className="w-4 h-4 inline mr-2" /> Live Webcam
            </button>
            <button
              onClick={() => setActiveTab("upload")}
              className={`pb-2 text-sm font-medium transition-colors ${activeTab === "upload" ? "border-b-2 border-primary text-primary" : "text-gray-500"}`}
            >
              <Upload className="w-4 h-4 inline mr-2" /> Video Analysis
            </button>
          </div>

          {/* Viewport */}
          <div className="relative bg-black rounded-xl overflow-hidden aspect-video flex items-center justify-center group">
            {activeTab === "live" ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-contain"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                />
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900">
                {videoPreview ? (
                  <video
                    ref={uploadVideoRef}
                    src={videoPreview}
                    controls
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center p-6">
                    <Upload className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <label className="cursor-pointer bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90 transition">
                      Select Video File
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Status Indicator */}
            <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/60 backdrop-blur px-3 py-1.5 rounded-full">
              <div
                className={`w-2 h-2 rounded-full ${isProcessing || isAnalyzing ? "bg-green-500 animate-pulse" : "bg-gray-500"}`}
              />
              <span className="text-xs text-white font-medium">
                {isAnalyzing
                  ? `Analyzing... ${analysisProgress}%`
                  : isProcessing
                    ? "Scanning..."
                    : "Ready"}
              </span>
            </div>
          </div>

          {/* Video Upload: Analyze Button */}
          {activeTab === "upload" && videoPreview && !analysisResult && (
            <button
              onClick={handleAnalyzeVideo}
              disabled={isAnalyzing || !selectedCategory}
              className="w-full flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing Video...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Analyze Video for Lost Item
                </>
              )}
            </button>
          )}

          {/* Analysis Results Panel */}
          {activeTab === "upload" && analysisResult && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-text-primary">
                  AI Analysis Results
                </h3>
              </div>

              {/* AI Confidence */}
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div
                    className={`text-3xl font-bold ${
                      analysisResult.aiAnalysis.matchConfidence >= 70
                        ? "text-green-600"
                        : analysisResult.aiAnalysis.matchConfidence >= 40
                          ? "text-yellow-600"
                          : "text-red-600"
                    }`}
                  >
                    {Math.round(analysisResult.aiAnalysis.matchConfidence)}%
                  </div>
                  <p className="text-xs text-gray-500">Match Confidence</p>
                </div>
                <div className="flex-1 bg-gray-100 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all ${
                      analysisResult.aiAnalysis.matchConfidence >= 70
                        ? "bg-green-500"
                        : analysisResult.aiAnalysis.matchConfidence >= 40
                          ? "bg-yellow-500"
                          : "bg-red-500"
                    }`}
                    style={{
                      width: `${analysisResult.aiAnalysis.matchConfidence}%`,
                    }}
                  />
                </div>
              </div>

              {/* AI Explanation */}
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  {analysisResult.aiAnalysis.explanation ||
                    "Analysis completed. Review keyframes for verification."}
                </p>
              </div>

              {/* Recommendations */}
              {analysisResult.aiAnalysis.recommendations.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-600">
                    Recommendations
                  </h4>
                  <ul className="text-sm text-gray-700 space-y-1">
                    {analysisResult.aiAnalysis.recommendations.map(
                      (rec, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                          {rec}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}

              {/* New Analysis Button */}
              <button
                onClick={() => {
                  setAnalysisResult(null);
                  setVideoPreview(null);
                  setSelectedKeyframe(null);
                }}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Upload New Video
              </button>
            </div>
          )}

          {/* Info Note */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0" />
            <p className="text-sm text-blue-700">
              <strong>Admin Note:</strong>{" "}
              {activeTab === "live"
                ? "Click 'Scan' to detect objects in the current frame. Detected items can be registered as found."
                : "Select a lost item, upload a video, and click 'Analyze' to find keyframes where the item appears."}
            </p>
          </div>
        </div>
      </div>

      {/* Add Item Modal (Found) */}
      {showAddModal && (
        <AddItemModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => setShowAddModal(false)}
          initialData={foundItemData}
          initialType="Found"
        />
      )}
    </div>
  );
}

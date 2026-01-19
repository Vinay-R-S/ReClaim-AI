import { useState, useRef, useEffect, useCallback } from "react";
import {
  Camera,
  Upload,
  Target,
  AlertTriangle,
  Video,
  Plus,
} from "../../lib/icons";
import { getItems, type Item } from "../../services/itemService";
import {
  detectObjectsInFrame,
  captureFrame,
  type Detection,
} from "../../services/cctvService";
import { AddItemModal } from "../../components/admin/AddItemModal";

export function CCTVIntelligence() {
  const [activeTab, setActiveTab] = useState<"live" | "upload">("live");
  const [lostItems, setLostItems] = useState<Item[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);

  // Webcam refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Video Upload State
  const [videoPreview, setVideoPreview] = useState<string | null>(null);

  // Register Found Workflow
  const [showAddModal, setShowAddModal] = useState(false);
  const [foundItemData, setFoundItemData] = useState<any>(null);

  // 1. Fetch Lost Items
  useEffect(() => {
    getItems().then((items) => {
      // Filter for Lost items only
      // In a real app, we'd also filter by Admin Location radius here
      setLostItems(
        items.filter((i) => i.type === "Lost" && i.status === "Pending"),
      );
    });
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

  // 3. Detection Loop (1 FPS)
  const runDetection = useCallback(async () => {
    if (!videoRef.current || isProcessing) return;

    try {
      setIsProcessing(true);
      const frameBase64 = captureFrame(videoRef.current);

      // If a specific item is selected, we could filter targetClasses in backend
      // For now, we detect everything and highlight matches in UI
      const results = await detectObjectsInFrame(frameBase64);

      setDetections(results.detections);
      drawDetections(results.detections);
    } catch (err) {
      console.error("Detection failed:", err);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing]);

  useEffect(() => {
    if (activeTab === "live" && !intervalRef.current) {
      intervalRef.current = setInterval(runDetection, 1000); // 1 FPS
    }
  }, [activeTab, runDetection]);

  // 4. Drawing Bounding Boxes
  const drawDetections = (currentDetections: Detection[]) => {
    if (!canvasRef.current || !videoRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // Clear previous drawings
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    // Match canvas size to video
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;

    currentDetections.forEach((det) => {
      // Scale coordinates if necessary (here we assume 1:1 because of captureFrame logic)
      const [x1, y1, x2, y2] = det.bbox;
      const width = x2 - x1;
      const height = y2 - y1;

      // Check if matches selected item
      const isMatch =
        selectedItem &&
        det.className
          .toLowerCase()
          .includes(
            selectedItem.category?.toLowerCase() ||
              selectedItem.name.toLowerCase(),
          );

      ctx.strokeStyle = isMatch ? "#22c55e" : "#ef4444"; // Green if match, Red otherwise
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, width, height);

      // Label background
      ctx.fillStyle = isMatch ? "#22c55e" : "#ef4444";
      ctx.fillRect(x1, y1 - 25, width, 25);

      // Text
      ctx.fillStyle = "#ffffff";
      ctx.font = "16px sans-serif";
      ctx.fillText(
        `${det.className} ${Math.round(det.confidence * 100)}%`,
        x1 + 5,
        y1 - 5,
      );
    });
  };

  // 5. Register Found Item Logic
  const handleRegisterFound = (det: Detection) => {
    if (!det.croppedImage) return;

    setFoundItemData({
      name: `Found ${det.className}`, // Auto-generated title
      description: `Detected via CCTV Intelligence. Object identified as ${det.className}.`,
      category: det.className, // Fallback category
      imageUrl: det.croppedImage, // Pre-fill image
      // Location could be pre-filled from Admin settings
      location: "Admin Office (CCTV)",
    });

    setShowAddModal(true);
  };

  // 6. File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      // setUploadedFile(file); // Unused for now
      setVideoPreview(URL.createObjectURL(file));
      // In a real app we'd process the video frame by frame similar to webcam
      // For MVP we can just show preview and say "Real-time only supported on Webcam for MVP"
      // OR implement frame extraction from video element.
    }
  };

  // Reuse detection loop for uploaded video if playing?
  // For simplicity MVP, let's attach detection to the uploaded video element too!
  const onVideoPlay = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    // videoRef.current = e.currentTarget; // Don't assign to ref, use closure
    const videoEl = e.currentTarget;
    if (!intervalRef.current) {
      intervalRef.current = setInterval(async () => {
        if (isProcessing) return;
        try {
          setIsProcessing(true);
          const frameBase64 = captureFrame(videoEl);
          const results = await detectObjectsInFrame(frameBase64);
          setDetections(results.detections);
          drawDetections(results.detections);
        } catch (err) {
          console.error(err);
        } finally {
          setIsProcessing(false);
        }
      }, 1000);
    }
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
              <Target className="w-4 h-4" /> Target Lost Item
            </label>
            <select
              className="w-full p-2 border rounded-lg text-sm"
              onChange={(e) =>
                setSelectedItem(
                  lostItems.find((i) => i.id === e.target.value) || null,
                )
              }
            >
              <option value="">-- Monitor All Objects --</option>
              {lostItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.category})
                </option>
              ))}
            </select>

            {selectedItem && (
              <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-700">
                Monitoring for{" "}
                <strong>{selectedItem.category || selectedItem.name}</strong>.
                Matching objects will be highlighted in green.
              </div>
            )}
          </div>

          <hr />

          {/* Detections List */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-text-primary">
              Live Detections
            </h3>
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {detections.length === 0 && (
                <p className="text-xs text-gray-400 italic">
                  No objects detected...
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
                    <span className="text-xs bg-gray-200 px-2 py-1 rounded-full">
                      {Math.round(det.confidence * 100)}%
                    </span>
                  </div>

                  {/* Action Button: Register Found */}
                  <button
                    onClick={() => handleRegisterFound(det)}
                    className="text-xs flex items-center justify-center gap-1 bg-primary text-white py-1.5 rounded hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Register as Found
                  </button>
                </div>
              ))}
            </div>
          </div>
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
              <Upload className="w-4 h-4 inline mr-2" /> Video Upload
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
                  <>
                    <video
                      src={videoPreview}
                      controls
                      onPlay={onVideoPlay}
                      onPause={() => isProcessing && setIsProcessing(false)}
                      className="absolute inset-0 w-full h-full object-contain"
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full pointer-events-none"
                    />
                  </>
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
                className={`w-2 h-2 rounded-full ${isProcessing ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
              />
              <span className="text-xs text-white font-medium">
                {isProcessing ? "AI Detection Active" : "Standby"}
              </span>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0" />
            <p className="text-sm text-blue-700">
              <strong>Admin Note:</strong> Ensure the inspection area is
              well-lit. Detected items can be instantly registered into the
              "Found Items" database by clicking "Register as Found".
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

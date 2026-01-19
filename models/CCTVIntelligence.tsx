import { useState, useEffect, useRef } from "react";
import { Upload, Search, RefreshCw, Clock, Video, AlertTriangle, CheckCircle, ChevronDown, Sparkles } from "lucide-react";
import { getItems, type Item } from "../../services/itemService";
import { analyzeCCTV, type CCTVAnalysisResult, type Detection, type AIProvider, COCO_CLASSES } from "../../services/cctvService";

export function CCTVIntelligence() {
    const [lostItems, setLostItems] = useState<Item[]>([]);
    const [selectedItem, setSelectedItem] = useState<Item | null>(null);
    const [organization, setOrganization] = useState("");
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoPreview, setVideoPreview] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [fetchingItems, setFetchingItems] = useState(true);
    const [results, setResults] = useState<CCTVAnalysisResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Category search with COCO classes autocomplete
    const [categoryInput, setCategoryInput] = useState("");
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const [filteredClasses, setFilteredClasses] = useState<string[]>([]);
    const categoryInputRef = useRef<HTMLDivElement>(null);

    // AI Provider selection
    const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');

    // Filter COCO classes based on input
    useEffect(() => {
        if (categoryInput.trim()) {
            const filtered = COCO_CLASSES.filter(c =>
                c.toLowerCase().includes(categoryInput.toLowerCase())
            );
            setFilteredClasses(filtered);
        } else {
            setFilteredClasses(COCO_CLASSES);
        }
    }, [categoryInput]);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (categoryInputRef.current && !categoryInputRef.current.contains(event.target as Node)) {
                setShowCategoryDropdown(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Fetch lost items on mount
    useEffect(() => {
        const fetchLostItems = async () => {
            try {
                setFetchingItems(true);
                const allItems = await getItems();
                // Filter only Lost items
                const lost = allItems.filter(item => item.type === "Lost");
                setLostItems(lost);
            } catch (err) {
                console.error("Failed to fetch lost items:", err);
                setError("Failed to load lost items");
            } finally {
                setFetchingItems(false);
            }
        };
        fetchLostItems();
    }, []);

    // Handle video file selection
    const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Validate file type
            if (!file.type.includes("video/mp4") && !file.type.includes("video/avi") && !file.type.includes("video/x-msvideo")) {
                setError("Please upload MP4 or AVI video files only");
                return;
            }
            setVideoFile(file);
            setVideoPreview(URL.createObjectURL(file));
            setError(null);
        }
    };

    // Get target item for detection (either from selected item or category input)
    const getTargetItem = (): string => {
        if (categoryInput.trim()) {
            return categoryInput.trim();
        }
        if (selectedItem) {
            return selectedItem.category || selectedItem.name.toLowerCase();
        }
        return "";
    };

    // Check if all fields are filled
    const canRunAnalysis = (selectedItem || categoryInput.trim()) && organization.trim() && videoFile;

    // Run AI Analysis
    const handleRunAnalysis = async () => {
        if (!canRunAnalysis || !videoFile) return;

        try {
            setLoading(true);
            setError(null);
            setResults(null);

            const targetItem = getTargetItem();
            const result = await analyzeCCTV(videoFile, targetItem, organization, aiProvider);
            setResults(result);
        } catch (err) {
            console.error("Analysis failed:", err);
            setError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // Reset form
    const handleReset = () => {
        setSelectedItem(null);
        setOrganization("");
        setVideoFile(null);
        setVideoPreview(null);
        setResults(null);
        setError(null);
        setCategoryInput("");
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    // Select category from dropdown
    const handleSelectCategory = (className: string) => {
        setCategoryInput(className);
        setShowCategoryDropdown(false);
        // Clear selected item if category is manually entered
        setSelectedItem(null);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                        <Video className="w-7 h-7 text-primary" />
                        CCTV Intelligence – Lost Item Analysis
                    </h1>
                    <p className="text-text-secondary mt-1">
                        AI-powered detection of lost items from CCTV footage using YOLOv8
                    </p>
                </div>
                <button
                    onClick={handleReset}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    title="Reset"
                >
                    <RefreshCw className="w-5 h-5 text-text-secondary" />
                </button>
            </div>

            {/* Demo Notice */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                    <p className="text-sm font-medium text-blue-800">Demo Mode</p>
                    <p className="text-sm text-blue-700 mt-1">
                        For demo purposes, we simulate CCTV footage analysis. YOLO detection runs on the server
                        with pretrained COCO model (80 object classes).
                    </p>
                </div>
            </div>

            {/* AI Provider Selection */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <span className="text-sm font-medium text-text-primary">AI Provider for Analysis</span>
                    </div>
                    <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-lg">
                        <button
                            onClick={() => setAiProvider('gemini')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${aiProvider === 'gemini'
                                ? 'bg-white text-primary shadow-sm'
                                : 'text-text-secondary hover:text-text-primary'
                                }`}
                        >
                            🌟 Gemini
                        </button>
                        <button
                            onClick={() => setAiProvider('groq')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${aiProvider === 'groq'
                                ? 'bg-white text-primary shadow-sm'
                                : 'text-text-secondary hover:text-text-primary'
                                }`}
                        >
                            ⚡ Groq
                        </button>
                    </div>
                </div>
                <p className="text-xs text-text-secondary mt-2">
                    {aiProvider === 'gemini'
                        ? 'Google Gemini - Best for detailed explanations'
                        : 'Groq - Ultra-fast inference with Llama models'}
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Input Panel */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
                    <h2 className="text-lg font-semibold text-text-primary">Analysis Configuration</h2>

                    {/* Select Lost Item */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-text-primary">
                            Select Lost Item (Optional)
                        </label>
                        {fetchingItems ? (
                            <div className="flex items-center gap-2 text-text-secondary text-sm py-2">
                                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                Loading lost items...
                            </div>
                        ) : (
                            <select
                                value={selectedItem?.id || ""}
                                onChange={(e) => {
                                    const item = lostItems.find(i => i.id === e.target.value);
                                    setSelectedItem(item || null);
                                    if (item) setCategoryInput(""); // Clear category if selecting item
                                }}
                                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            >
                                <option value="">Choose a lost item to search for...</option>
                                {lostItems.map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.name} – {item.location.split(",")[0]}
                                    </option>
                                ))}
                            </select>
                        )}
                        {selectedItem && (
                            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg mt-2">
                                {(selectedItem.cloudinaryUrls?.[0] || selectedItem.imageUrl) ? (
                                    <img
                                        src={selectedItem.cloudinaryUrls?.[0] || selectedItem.imageUrl}
                                        alt={selectedItem.name}
                                        className="w-12 h-12 rounded-lg object-cover"
                                    />
                                ) : (
                                    <div className="w-12 h-12 rounded-lg bg-gray-200 flex items-center justify-center text-lg">
                                        📦
                                    </div>
                                )}
                                <div>
                                    <p className="font-medium text-text-primary text-sm">{selectedItem.name}</p>
                                    <p className="text-xs text-text-secondary">
                                        Category: {selectedItem.category || "Unknown"}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* OR Divider */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-xs text-text-secondary font-medium">OR</span>
                        <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Category Input with Autocomplete */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-text-primary">
                            Search by YOLOv8 Class <span className="text-red-500">*</span>
                        </label>
                        <div className="relative" ref={categoryInputRef}>
                            <input
                                type="text"
                                value={categoryInput}
                                onChange={(e) => {
                                    setCategoryInput(e.target.value);
                                    setShowCategoryDropdown(true);
                                    if (e.target.value) setSelectedItem(null);
                                }}
                                onFocus={() => setShowCategoryDropdown(true)}
                                placeholder="Type to search: backpack, laptop, cell phone..."
                                className="w-full px-4 py-3 pr-10 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                            <ChevronDown
                                className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`}
                                onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                            />

                            {/* Dropdown */}
                            {showCategoryDropdown && (
                                <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                                    {filteredClasses.length === 0 ? (
                                        <div className="px-4 py-3 text-sm text-text-secondary">
                                            No matching classes found
                                        </div>
                                    ) : (
                                        filteredClasses.map(className => (
                                            <button
                                                key={className}
                                                onClick={() => handleSelectCategory(className)}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-primary/10 hover:text-primary transition-colors"
                                            >
                                                {className}
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-text-secondary">
                            {COCO_CLASSES.length} classes available • Common: backpack, handbag, laptop, cell phone, suitcase
                        </p>
                    </div>

                    {/* Organization/Location */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-text-primary">
                            Organization / Location <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={organization}
                            onChange={(e) => setOrganization(e.target.value)}
                            placeholder="e.g., RV University, UB City Mall"
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        />
                    </div>

                    {/* Video Upload */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-text-primary">
                            Upload CCTV Video <span className="text-red-500">*</span>
                        </label>
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${videoFile ? "border-primary bg-primary/5" : "border-gray-200 hover:border-primary hover:bg-gray-50"
                                }`}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="video/mp4,video/avi,video/x-msvideo"
                                onChange={handleVideoChange}
                                className="hidden"
                            />
                            {videoFile ? (
                                <div className="space-y-2">
                                    <CheckCircle className="w-8 h-8 text-primary mx-auto" />
                                    <p className="text-sm font-medium text-text-primary">{videoFile.name}</p>
                                    <p className="text-xs text-text-secondary">
                                        {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Upload className="w-8 h-8 text-gray-400 mx-auto" />
                                    <p className="text-sm text-text-secondary">
                                        Click to upload MP4 or AVI video
                                    </p>
                                    <p className="text-xs text-gray-400">Max recommended: 50MB</p>
                                </div>
                            )}
                        </div>
                        {videoPreview && (
                            <video
                                src={videoPreview}
                                controls
                                className="w-full rounded-lg mt-3 max-h-48"
                            />
                        )}
                    </div>

                    {/* Current Target Display */}
                    {(categoryInput || selectedItem) && (
                        <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg p-3 border border-primary/20">
                            <p className="text-xs font-medium text-primary uppercase tracking-wide">Detecting</p>
                            <p className="text-lg font-bold text-text-primary mt-1">{getTargetItem()}</p>
                        </div>
                    )}

                    {/* Error Display */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                            <p className="text-sm text-red-700">{error}</p>
                        </div>
                    )}

                    {/* Run Analysis Button */}
                    <button
                        onClick={handleRunAnalysis}
                        disabled={!canRunAnalysis || loading}
                        className={`w-full py-3 px-4 rounded-xl font-medium text-white flex items-center justify-center gap-2 transition-all ${canRunAnalysis && !loading
                            ? "bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
                            : "bg-gray-300 cursor-not-allowed"
                            }`}
                    >
                        {loading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Analyzing Video...
                            </>
                        ) : (
                            <>
                                <Search className="w-5 h-5" />
                                Run AI Analysis
                            </>
                        )}
                    </button>
                </div>

                {/* Results Panel */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                    <h2 className="text-lg font-semibold text-text-primary mb-4">Analysis Results</h2>

                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 space-y-4">
                            <div className="relative">
                                <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
                                <div className="absolute inset-0 w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                            </div>
                            <div className="text-center">
                                <p className="font-medium text-text-primary">Analyzing CCTV Footage</p>
                                <p className="text-sm text-text-secondary mt-1">
                                    Running YOLOv8 detection for "{getTargetItem()}"...
                                </p>
                            </div>
                        </div>
                    ) : results ? (
                        <div className="space-y-5">
                            {/* Summary Stats */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-4">
                                    <p className="text-2xl font-bold text-primary">{results.totalCount}</p>
                                    <p className="text-sm text-text-secondary">Detections Found</p>
                                </div>
                                <div className="bg-gradient-to-br from-blue-100 to-blue-50 rounded-xl p-4">
                                    <p className="text-2xl font-bold text-blue-700">👥 {results.peopleCount || 0}</p>
                                    <p className="text-sm text-text-secondary">People Detected</p>
                                </div>
                                <div className="bg-gradient-to-br from-orange-100 to-orange-50 rounded-xl p-4">
                                    <p className="text-sm font-bold text-orange-700 flex items-center gap-1">
                                        <Clock className="w-4 h-4" />
                                        {results.lastSeenTime || "N/A"}
                                    </p>
                                    <p className="text-sm text-text-secondary">Last Seen</p>
                                </div>
                            </div>

                            {/* Target Item */}
                            <div className="bg-gray-50 rounded-lg p-3">
                                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Target Item</p>
                                <p className="text-lg font-semibold text-text-primary mt-1">{results.targetItem}</p>
                            </div>

                            {/* AI Explanation */}
                            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-4 border border-purple-100">
                                <p className="text-xs font-medium text-purple-700 uppercase tracking-wide mb-2">
                                    🧠 AI Explanation
                                </p>
                                <p className="text-sm text-text-primary leading-relaxed">
                                    {results.explanation}
                                </p>
                            </div>

                            {/* Key Frames */}
                            {results.keyFrames && results.keyFrames.length > 0 && (
                                <div className="space-y-3">
                                    <p className="text-sm font-medium text-text-primary">Key Frames</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {results.keyFrames.slice(0, 4).map((frame: string, idx: number) => (
                                            <div key={idx} className="relative rounded-lg overflow-hidden bg-gray-100 aspect-video">
                                                <img
                                                    src={frame}
                                                    alt={`Detection frame ${idx + 1}`}
                                                    className="w-full h-full object-cover"
                                                />
                                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                                                    <p className="text-xs text-white">Frame {idx + 1}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Detections List */}
                            {results.detections && results.detections.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-text-primary">Detection Log</p>
                                    <div className="max-h-40 overflow-y-auto space-y-1">
                                        {results.detections.map((det: Detection, idx: number) => (
                                            <div key={idx} className="flex items-center justify-between text-xs bg-gray-50 rounded px-3 py-2">
                                                <span className="text-text-primary font-medium">{det.className}</span>
                                                <span className="text-text-secondary">{det.timestamp}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                                <Video className="w-8 h-8 text-gray-400" />
                            </div>
                            <p className="text-text-secondary">
                                Select a lost item or enter a YOLOv8 class, upload CCTV footage,
                                and run analysis to see detection results.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

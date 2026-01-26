/**
 * Admin Settings Page - Configure system settings
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Save,
  Bot,
  Loader2,
  MapPin,
  X,
  Search,
  Video,
  Users,
  RefreshCw,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type AIProvider =
  | "groq_only"
  | "gemini_only"
  | "groq_with_fallback"
  | "gemini_with_fallback";

interface MapCenter {
  address: string;
  lat: number;
  lng: number;
}

interface SystemSettings {
  aiProvider: AIProvider;
  mapCenter?: MapCenter;
  cctvEnabled: boolean;
  testingMode: boolean;
}

const AI_PROVIDER_OPTIONS: {
  value: AIProvider;
  label: string;
  description: string;
}[] = [
  {
    value: "groq_only",
    label: "Groq Only",
    description: "Use Groq (LLaMA) exclusively. No fallback if Groq fails.",
  },
  {
    value: "gemini_only",
    label: "Gemini Only",
    description: "Use Google Gemini exclusively. No fallback if Gemini fails.",
  },
  {
    value: "groq_with_fallback",
    label: "Groq (with Gemini fallback)",
    description: "Primary: Groq. Fallback to Gemini if Groq fails.",
  },
  {
    value: "gemini_with_fallback",
    label: "Gemini (with Groq fallback)",
    description: "Primary: Gemini. Fallback to Groq if Gemini fails.",
  },
];

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Default marker icon
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface GeocodingResult {
  formatted: string;
  lat: number;
  lon: number;
}

export function AdminSettings() {
  const [settings, setSettings] = useState<SystemSettings>({
    aiProvider: "groq_only",
    cctvEnabled: true,
    testingMode: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [visitorCount, setVisitorCount] = useState<number>(0);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);

  // Map center state
  const [addressQuery, setAddressQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY;

  // Fetch current settings and analytics
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings`);
        if (response.ok) {
          const data = await response.json();
          // Ensure booleans are properly set to avoid controlled/uncontrolled input issues
          setSettings({
            ...data,
            cctvEnabled: data.cctvEnabled !== false,
            testingMode: data.testingMode === true,
          });
          if (data.mapCenter?.address) {
            setAddressQuery(data.mapCenter.address);
          }
        }

        // Fetch analytics (visitor count)
        const analyticsResponse = await fetch(
          `${API_BASE_URL}/api/settings/analytics`,
        );
        if (analyticsResponse.ok) {
          const analyticsData = await analyticsResponse.json();
          setVisitorCount(analyticsData.visitorCount || 0);
        }
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const defaultCenter: [number, number] = settings.mapCenter
      ? [settings.mapCenter.lat, settings.mapCenter.lng]
      : [12.9716, 77.5946]; // Default to Bangalore

    mapRef.current = L.map(mapContainerRef.current).setView(defaultCenter, 14);

    // Add tile layer
    if (apiKey) {
      L.tileLayer(
        `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${apiKey}`,
        {
          maxZoom: 18,
          attribution: "© Geoapify © OpenMapTiles © OpenStreetMap",
        },
      ).addTo(mapRef.current);
    } else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(mapRef.current);
    }

    // Add marker if we have a saved center
    if (settings.mapCenter) {
      markerRef.current = L.marker(
        [settings.mapCenter.lat, settings.mapCenter.lng],
        { icon: defaultIcon },
      ).addTo(mapRef.current);
    }

    // Click handler for map
    mapRef.current.on("click", async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;

      // Update marker
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else if (mapRef.current) {
        markerRef.current = L.marker([lat, lng], { icon: defaultIcon }).addTo(
          mapRef.current,
        );
      }

      // Reverse geocode
      if (apiKey) {
        try {
          const response = await fetch(
            `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${apiKey}`,
          );
          const data = await response.json();
          if (data.features?.[0]?.properties?.formatted) {
            const address = data.features[0].properties.formatted;
            setAddressQuery(address);
            setSettings((prev) => ({
              ...prev,
              mapCenter: { address, lat, lng },
            }));
          }
        } catch (err) {
          console.error("Reverse geocoding failed:", err);
        }
      } else {
        setSettings((prev) => ({
          ...prev,
          mapCenter: {
            address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            lat,
            lng,
          },
        }));
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [isLoading]); // Only run after loading completes

  // Fetch address suggestions
  const fetchSuggestions = useCallback(
    async (searchQuery: string) => {
      if (!apiKey || searchQuery.length < 3) {
        setSuggestions([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(
            searchQuery,
          )}&apiKey=${apiKey}&limit=5`,
        );
        const data = await response.json();

        if (data.features) {
          setSuggestions(
            data.features.map(
              (f: {
                properties: { formatted: string; lat: number; lon: number };
              }) => ({
                formatted: f.properties.formatted,
                lat: f.properties.lat,
                lon: f.properties.lon,
              }),
            ),
          );
        }
      } catch (err) {
        console.error("Error fetching suggestions:", err);
      } finally {
        setIsSearching(false);
      }
    },
    [apiKey],
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (addressQuery.length >= 3) {
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(addressQuery);
      }, 300);
    } else {
      setSuggestions([]);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [addressQuery, fetchSuggestions]);

  // Handle suggestion selection
  const handleSelectSuggestion = (result: GeocodingResult) => {
    setAddressQuery(result.formatted);
    setSettings((prev) => ({
      ...prev,
      mapCenter: {
        address: result.formatted,
        lat: result.lat,
        lng: result.lon,
      },
    }));
    setShowSuggestions(false);

    // Update map
    if (mapRef.current) {
      mapRef.current.setView([result.lat, result.lon], 15);

      if (markerRef.current) {
        markerRef.current.setLatLng([result.lat, result.lon]);
      } else {
        markerRef.current = L.marker([result.lat, result.lon], {
          icon: defaultIcon,
        }).addTo(mapRef.current);
      }
    }
  };

  // Save settings
  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus("idle");

    try {
      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        setSaveStatus("success");
        // Reload page after short delay to update global state (like sidebar)
        setTimeout(() => {
          setSaveStatus("idle");
          window.location.reload();
        }, 1000);
      } else {
        setSaveStatus("error");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="text-text-secondary mt-1">
          Configure system-wide settings for ReClaim AI
        </p>
      </div>

      {/* Map Center Section */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-text-primary">
              Heatmap Center Point
            </h2>
            <p className="text-sm text-text-secondary">
              Set the center location for the item location heatmap
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Address Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary z-10" />
            <input
              type="text"
              value={addressQuery}
              onChange={(e) => {
                setAddressQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Search for an address..."
              className="w-full pl-10 pr-10 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            />
            {addressQuery && (
              <button
                onClick={() => {
                  setAddressQuery("");
                  setSettings((prev) => ({ ...prev, mapCenter: undefined }));
                  if (markerRef.current && mapRef.current) {
                    mapRef.current.removeLayer(markerRef.current);
                    markerRef.current = null;
                  }
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary z-10"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                {suggestions.map((result, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectSuggestion(result)}
                    className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-start gap-2 border-b border-border last:border-b-0"
                  >
                    <MapPin className="w-4 h-4 text-google-red mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-text-primary line-clamp-2">
                      {result.formatted}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Loading indicator */}
            {isSearching && (
              <div className="absolute right-10 top-1/2 -translate-y-1/2 z-10">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Map Preview */}
          <div
            ref={mapContainerRef}
            className="w-full h-64 rounded-lg border border-border overflow-hidden"
            style={{ zIndex: 1 }}
          />

          <p className="text-xs text-text-secondary text-center">
            Click on the map or search for an address to set the heatmap center
          </p>

          {settings.mapCenter && (
            <div className="bg-green-50 rounded-lg p-3 text-sm">
              <p className="text-green-800 font-medium">Current Center:</p>
              <p className="text-green-700 mt-1">
                {settings.mapCenter.address}
              </p>
              <p className="text-green-600 text-xs mt-1">
                Coordinates: {settings.mapCenter.lat.toFixed(6)},{" "}
                {settings.mapCenter.lng.toFixed(6)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Feature Toggles Section */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
            <Video className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-text-primary">
              Feature Toggles
            </h2>
            <p className="text-sm text-text-secondary">
              Enable or disable optional features
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* CCTV Intelligence Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-border">
            <div className="flex-1">
              <h3 className="font-medium text-text-primary">
                CCTV Intelligence
              </h3>
              <p className="text-sm text-text-secondary mt-1">
                AI-powered object detection using webcam or video uploads.
                Requires the ML models service to be running.
              </p>
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                Disable this if hosting on Render without the models service
              </p>
            </div>
            <div className="flex items-center gap-3 ml-4">
              <span
                className={`text-sm font-medium ${settings.cctvEnabled ? "text-gray-400" : "text-red-600"}`}
              >
                Disabled
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.cctvEnabled}
                  onChange={(e) =>
                    setSettings({ ...settings, cctvEnabled: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
              <span
                className={`text-sm font-medium ${settings.cctvEnabled ? "text-green-600" : "text-gray-400"}`}
              >
                Enabled
              </span>
            </div>
          </div>

          {/* Testing Mode Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-border">
            <div className="flex-1">
              <h3 className="font-medium text-text-primary">Deployment Mode</h3>
              <p className="text-sm text-text-secondary mt-1">
                Switch between Dev mode (unlimited) and Testing mode (400 API
                calls/day limit).
              </p>
              <div className="mt-2 flex gap-4 text-xs">
                <span
                  className={`flex items-center gap-1.5 ${!settings.testingMode ? "text-green-600 font-medium" : "text-gray-400"}`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${!settings.testingMode ? "bg-green-500" : "bg-gray-300"}`}
                  ></span>
                  Dev Mode - No limits
                </span>
                <span
                  className={`flex items-center gap-1.5 ${settings.testingMode ? "text-blue-600 font-medium" : "text-gray-400"}`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${settings.testingMode ? "bg-blue-500" : "bg-gray-300"}`}
                  ></span>
                  Testing Mode - 400/day limit
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 ml-4">
              <span
                className={`text-sm font-medium ${settings.testingMode ? "text-gray-400" : "text-green-600"}`}
              >
                Dev
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.testingMode}
                  onChange={(e) =>
                    setSettings({ ...settings, testingMode: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
              </label>
              <span
                className={`text-sm font-medium ${settings.testingMode ? "text-blue-600" : "text-gray-400"}`}
              >
                Testing
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Site Analytics Section (Admin Secret) */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
            <Users className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-text-primary">
              Site Analytics
            </h2>
            <p className="text-sm text-text-secondary">
              Track visitor statistics (admin only)
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 rounded-lg bg-indigo-50 border border-indigo-100">
          <div>
            <p className="text-sm text-indigo-600 font-medium">
              Total Visitors
            </p>
            <p className="text-3xl font-bold text-indigo-700 mt-1">
              {visitorCount.toLocaleString()}
            </p>
            <p className="text-xs text-indigo-500 mt-1">
              Unique visits tracked in Testing mode
            </p>
          </div>
          <button
            onClick={async () => {
              setIsLoadingAnalytics(true);
              try {
                const response = await fetch(
                  `${API_BASE_URL}/api/settings/analytics`,
                );
                if (response.ok) {
                  const data = await response.json();
                  setVisitorCount(data.visitorCount || 0);
                }
              } catch (error) {
                console.error("Failed to refresh analytics:", error);
              } finally {
                setIsLoadingAnalytics(false);
              }
            }}
            disabled={isLoadingAnalytics}
            className="p-2 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-5 h-5 text-indigo-600 ${isLoadingAnalytics ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* AI Provider Section */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-text-primary">
              AI Provider
            </h2>
            <p className="text-sm text-text-secondary">
              Choose which AI model to use for chat and matching
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {AI_PROVIDER_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-all ${
                settings.aiProvider === option.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="aiProvider"
                value={option.value}
                checked={settings.aiProvider === option.value}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    aiProvider: e.target.value as AIProvider,
                  })
                }
                className="mt-1 w-4 h-4 text-primary focus:ring-primary"
              />
              <div>
                <span className="font-medium text-text-primary block">
                  {option.label}
                </span>
                <span className="text-sm text-text-secondary">
                  {option.description}
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-6 py-2.5 
                     bg-[#4285F4]
                     hover:bg-[#3367D6]
                     text-white font-medium rounded-lg
                     shadow-md hover:shadow-lg
                     transform transition-all duration-200 
                     hover:scale-[1.02] active:scale-[0.98]
                     disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100
                     focus:outline-none focus:ring-2 focus:ring-[#4285F4] focus:ring-offset-2"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {isSaving ? "Saving..." : "Save Settings"}
        </button>

        {saveStatus === "success" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[#34A853] font-medium bg-[#34A853]/10 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 bg-[#34A853] rounded-full animate-pulse"></span>
            Settings saved successfully
          </span>
        )}
        {saveStatus === "error" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[#EA4335] font-medium bg-[#EA4335]/10 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 bg-[#EA4335] rounded-full"></span>
            Failed to save settings
          </span>
        )}
      </div>
    </div>
  );
}

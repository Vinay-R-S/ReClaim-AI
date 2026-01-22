/**
 * Admin Profile Page
 * Shows admin info and office location (no credits)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  User,
  MapPin,
  Mail,
  Calendar,
  Save,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

interface AdminLocation {
  address: string;
  lat: number;
  lng: number;
}

export function AdminProfile() {
  const { user } = useAuth();
  const [location, setLocation] = useState<AdminLocation | null>(null);
  const [addressQuery, setAddressQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [isLoading, setIsLoading] = useState(true);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY;

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings`);
        if (response.ok) {
          const data = await response.json();
          if (data.mapCenter) {
            setLocation(data.mapCenter);
            setAddressQuery(data.mapCenter.address || "");
          }
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || isLoading) return;

    const defaultCenter: [number, number] = location
      ? [location.lat, location.lng]
      : [12.9716, 77.5946];

    mapRef.current = L.map(mapContainerRef.current).setView(defaultCenter, 14);

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

    if (location) {
      markerRef.current = L.marker([location.lat, location.lng], {
        icon: defaultIcon,
      }).addTo(mapRef.current);
    }

    // Click handler
    mapRef.current.on("click", async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else if (mapRef.current) {
        markerRef.current = L.marker([lat, lng], { icon: defaultIcon }).addTo(
          mapRef.current,
        );
      }

      if (apiKey) {
        try {
          const response = await fetch(
            `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${apiKey}`,
          );
          const data = await response.json();
          if (data.features?.[0]?.properties?.formatted) {
            const address = data.features[0].properties.formatted;
            setAddressQuery(address);
            setLocation({ address, lat, lng });
          }
        } catch (err) {
          console.error("Reverse geocoding failed:", err);
        }
      } else {
        setLocation({
          address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
          lat,
          lng,
        });
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [isLoading, apiKey]);

  // Fetch suggestions
  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!apiKey || query.length < 3) {
        setSuggestions([]);
        return;
      }
      setIsSearching(true);
      try {
        const response = await fetch(
          `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}&apiKey=${apiKey}&limit=5`,
        );
        const data = await response.json();
        if (data.features) {
          setSuggestions(
            data.features.map((f: any) => ({
              formatted: f.properties.formatted,
              lat: f.properties.lat,
              lon: f.properties.lon,
            })),
          );
        }
      } catch {
        /* ignore */
      } finally {
        setIsSearching(false);
      }
    },
    [apiKey],
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (addressQuery.length >= 3) {
      debounceRef.current = setTimeout(
        () => fetchSuggestions(addressQuery),
        300,
      );
    } else {
      setSuggestions([]);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [addressQuery, fetchSuggestions]);

  // Handle suggestion select
  const handleSelectSuggestion = (result: GeocodingResult) => {
    setAddressQuery(result.formatted);
    setLocation({
      address: result.formatted,
      lat: result.lat,
      lng: result.lon,
    });
    setShowSuggestions(false);

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

  // Save location
  const handleSave = async () => {
    if (!location) return;
    setIsSaving(true);
    setSaveStatus("idle");

    try {
      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiProvider: "groq_only", // Keep existing
          mapCenter: location,
        }),
      });

      if (response.ok) {
        setSaveStatus("success");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else {
        setSaveStatus("error");
      }
    } catch {
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
        <h1 className="text-2xl font-semibold text-text-primary">
          Admin Profile
        </h1>
        <p className="text-text-secondary mt-1">
          Your admin information and office location
        </p>
      </div>

      {/* Admin Info Card */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-text-primary">
              Account Info
            </h2>
            <p className="text-sm text-text-secondary">
              Your admin account details
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-full overflow-hidden bg-primary flex items-center justify-center text-white text-2xl font-bold">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || "Admin"}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              user?.displayName?.[0] || user?.email?.[0] || "A"
            )}
          </div>

          {/* Info */}
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-text-secondary" />
              <span className="font-medium text-text-primary">
                {user?.displayName || "Admin User"}
              </span>
              <span className="px-2 py-0.5 bg-primary text-white text-xs font-medium rounded">
                ADMIN
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-text-secondary" />
              <span className="text-text-secondary">{user?.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-text-secondary" />
              <span className="text-text-secondary">
                Member since{" "}
                {user?.metadata?.creationTime
                  ? new Date(user.metadata.creationTime).toLocaleDateString()
                  : "N/A"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Office Location Card */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-text-primary">
              Office Location
            </h2>
            <p className="text-sm text-text-secondary">
              Set your admin office location (used for heatmap center)
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
              placeholder="Search for your office address..."
              className="w-full pl-10 pr-10 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            />
            {addressQuery && (
              <button
                onClick={() => {
                  setAddressQuery("");
                  setLocation(null);
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

            {isSearching && (
              <div className="absolute right-10 top-1/2 -translate-y-1/2 z-10">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Map */}
          <div
            ref={mapContainerRef}
            className="w-full h-64 rounded-lg border border-border overflow-hidden"
            style={{ zIndex: 1 }}
          />

          <p className="text-xs text-text-secondary text-center">
            Click on the map or search to set your office location
          </p>

          {location && (
            <div className="bg-green-50 rounded-lg p-3 text-sm">
              <p className="text-green-800 font-medium">Current Location:</p>
              <p className="text-green-700 mt-1">{location.address}</p>
              <p className="text-green-600 text-xs mt-1">
                {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={isSaving || !location}
          className="inline-flex items-center gap-2 px-6 py-2.5 
                     bg-[#4285F4] hover:bg-[#3367D6]
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
          {isSaving ? "Saving..." : "Save Location"}
        </button>

        {saveStatus === "success" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[#34A853] font-medium bg-[#34A853]/10 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 bg-[#34A853] rounded-full animate-pulse"></span>
            Location saved successfully
          </span>
        )}
        {saveStatus === "error" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[#EA4335] font-medium bg-[#EA4335]/10 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 bg-[#EA4335] rounded-full"></span>
            Failed to save location
          </span>
        )}
      </div>
    </div>
  );
}

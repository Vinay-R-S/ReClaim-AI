import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Search, X } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface LocationPickerProps {
  value: string;
  onChange: (location: string) => void;
  placeholder?: string;
}

interface GeocodingResult {
  formatted: string;
  lat: number;
  lon: number;
}

// Fix Leaflet default marker icon issue
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

export function LocationPicker({
  value,
  onChange,
  placeholder = "Search for a location...",
}: LocationPickerProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const onChangeRef = useRef(onChange);

  // Keep ref updated
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY;

  // Initialize map only once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Default center (Bangalore, India)
    const defaultCenter: [number, number] = [12.9716, 77.5946];

    mapRef.current = L.map(mapContainerRef.current).setView(defaultCenter, 13);

    // Add Geoapify or OpenStreetMap tiles
    if (apiKey) {
      L.tileLayer(
        `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${apiKey}`,
        {
          maxZoom: 20,
          attribution: "© Geoapify © OpenMapTiles © OpenStreetMap",
        }
      ).addTo(mapRef.current);
    } else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(mapRef.current);
    }

    // Click handler for map
    mapRef.current.on("click", async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      setSelectedLocation({ lat, lon: lng });

      // Reverse geocode
      if (apiKey) {
        try {
          const response = await fetch(
            `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${apiKey}`
          );
          const data = await response.json();
          if (data.features?.[0]?.properties?.formatted) {
            const address = data.features[0].properties.formatted;
            setQuery(address);
            onChangeRef.current(address);
          }
        } catch (err) {
          console.error("Reverse geocoding failed:", err);
        }
      }

      // Update marker
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else if (mapRef.current) {
        markerRef.current = L.marker([lat, lng], { icon: defaultIcon }).addTo(
          mapRef.current
        );
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [apiKey]); // Only depend on apiKey, not onChange

  // Update marker when location changes
  useEffect(() => {
    if (selectedLocation && mapRef.current) {
      const { lat, lon } = selectedLocation;

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lon]);
      } else {
        markerRef.current = L.marker([lat, lon], { icon: defaultIcon }).addTo(
          mapRef.current
        );
      }

      mapRef.current.setView([lat, lon], 16);
    }
  }, [selectedLocation]);

  // Fetch address suggestions
  const fetchSuggestions = useCallback(
    async (searchQuery: string) => {
      if (!apiKey || searchQuery.length < 3) {
        setSuggestions([]);
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch(
          `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(
            searchQuery
          )}&apiKey=${apiKey}&limit=5`
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
              })
            )
          );
        }
      } catch (err) {
        console.error("Error fetching suggestions:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [apiKey]
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length >= 3) {
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(query);
      }, 300);
    } else {
      setSuggestions([]);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, fetchSuggestions]);

  // Handle suggestion selection
  const handleSelect = (result: GeocodingResult) => {
    setQuery(result.formatted);
    onChange(result.formatted);
    setSelectedLocation({ lat: result.lat, lon: result.lon });
    setShowSuggestions(false);
  };

  return (
    <div className="space-y-3">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary z-10" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              onChange("");
              setSelectedLocation(null);
              setSuggestions([]);
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
                onClick={() => handleSelect(result)}
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
        {isLoading && (
          <div className="absolute right-10 top-1/2 -translate-y-1/2 z-10">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Interactive Map */}
      <div
        ref={mapContainerRef}
        className="w-full h-48 rounded-lg border border-border overflow-hidden"
        style={{ zIndex: 1 }}
      />

      {/* Help text */}
      <p className="text-xs text-text-secondary text-center">
        Search for a location or click on the map to select
      </p>
    </div>
  );
}

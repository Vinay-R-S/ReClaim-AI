/**
 * Item Heatmap Component
 * Displays lost (red) and found (green) items on an interactive map
 * Uses Leaflet with the existing Geoapify tiles
 */

import { useState, useEffect, useRef } from "react";
import { MapPin, Map as MapIcon, Loader2 } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getItems, type Item } from "@/services/itemService";

interface ItemHeatmapProps {
  radiusKm?: number;
}

// Custom marker icons using divIcon for better performance
const createMarkerIcon = (color: string, borderColor: string) =>
  L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: 14px;
      height: 14px;
      background-color: ${color};
      border: 2px solid ${borderColor};
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });

const lostMarkerIcon = createMarkerIcon("#EA4335", "#B91C1C");
const foundMarkerIcon = createMarkerIcon("#34A853", "#166534");

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function ItemHeatmap({ radiusKm = 2.5 }: ItemHeatmapProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const circleRef = useRef<L.Circle | null>(null);

  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY;

  // Fetch items and settings
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch items and settings in parallel
        const [allItems, settingsResponse] = await Promise.all([
          getItems(),
          fetch(`${API_BASE_URL}/api/settings`).then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);

        // Filter items that have coordinates
        const itemsWithCoords = allItems.filter(
          (item) => item.coordinates?.lat && item.coordinates?.lng,
        );
        setItems(itemsWithCoords);

        // Priority for center:
        // 1. Saved mapCenter from settings
        // 2. Average of item coordinates
        // 3. Default (Bangalore)
        if (
          settingsResponse?.mapCenter?.lat &&
          settingsResponse?.mapCenter?.lng
        ) {
          setCenter({
            lat: settingsResponse.mapCenter.lat,
            lng: settingsResponse.mapCenter.lng,
          });
        } else if (itemsWithCoords.length > 0) {
          const avgLat =
            itemsWithCoords.reduce(
              (sum, item) => sum + (item.coordinates?.lat || 0),
              0,
            ) / itemsWithCoords.length;
          const avgLng =
            itemsWithCoords.reduce(
              (sum, item) => sum + (item.coordinates?.lng || 0),
              0,
            ) / itemsWithCoords.length;
          setCenter({ lat: avgLat, lng: avgLng });
        } else {
          // Default to Bangalore if no items
          setCenter({ lat: 12.9716, lng: 77.5946 });
        }
      } catch (error) {
        console.error("Failed to fetch data for heatmap:", error);
        setCenter({ lat: 12.9716, lng: 77.5946 });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Initialize map when center is available
  useEffect(() => {
    if (!mapContainerRef.current || !center || mapRef.current) return;

    // Create map with limited interactions (view-only, no editing)
    mapRef.current = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      dragging: true,
      // Disable editing interactions
      boxZoom: false,
      keyboard: false,
    }).setView([center.lat, center.lng], 14);

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

    // Add radius circle
    circleRef.current = L.circle([center.lat, center.lng], {
      radius: radiusKm * 1000, // Convert km to meters
      color: "#4285F4",
      fillColor: "#4285F4",
      fillOpacity: 0.08,
      weight: 2,
      dashArray: "8, 8",
    }).addTo(mapRef.current);

    // Cleanup
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [center, apiKey, radiusKm]);

  // Add markers when items change
  useEffect(() => {
    if (!mapRef.current || !items.length) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Add new markers
    items.forEach((item) => {
      if (!item.coordinates?.lat || !item.coordinates?.lng) return;

      const icon = item.type === "Lost" ? lostMarkerIcon : foundMarkerIcon;
      const marker = L.marker([item.coordinates.lat, item.coordinates.lng], {
        icon,
      }).addTo(mapRef.current!);

      // Create popup content
      const statusColor =
        item.status === "Matched"
          ? "#22c55e"
          : item.status === "Claimed"
            ? "#8b5cf6"
            : "#f59e0b";
      const typeColor = item.type === "Lost" ? "#EA4335" : "#34A853";

      marker.bindPopup(`
        <div style="min-width: 180px; font-family: system-ui, sans-serif;">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px; color: #1f2937;">
            ${item.name}
          </div>
          <div style="display: flex; gap: 6px; margin-bottom: 6px;">
            <span style="
              background: ${typeColor}; 
              color: white; 
              padding: 2px 8px; 
              border-radius: 12px; 
              font-size: 11px;
              font-weight: 500;
            ">${item.type}</span>
            <span style="
              background: ${statusColor}; 
              color: white; 
              padding: 2px 8px; 
              border-radius: 12px; 
              font-size: 11px;
              font-weight: 500;
            ">${item.status}</span>
          </div>
          <div style="font-size: 12px; color: #6b7280; line-clamp: 2; overflow: hidden;">
            ${item.location || "No location specified"}
          </div>
        </div>
      `);

      markersRef.current.push(marker);
    });
  }, [items]);

  // Count items by type
  const lostCount = items.filter((i) => i.type === "Lost").length;
  const foundCount = items.filter((i) => i.type === "Found").length;

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
        <div className="flex items-center justify-center h-80">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MapIcon className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-text-primary">
            Item Location Heatmap
          </h3>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#EA4335]" />
            <span className="text-text-secondary">Lost ({lostCount})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#34A853]" />
            <span className="text-text-secondary">Found ({foundCount})</span>
          </div>
        </div>
      </div>

      {/* Map Container */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-80 bg-gray-50 rounded-xl">
          <MapPin className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-text-secondary">No items with location data</p>
        </div>
      ) : (
        <div
          ref={mapContainerRef}
          className="w-full h-80 rounded-xl border border-gray-200 overflow-hidden"
          style={{ zIndex: 1 }}
        />
      )}

      {/* Footer info */}
      <p className="text-xs text-text-secondary text-center mt-3">
        Showing {items.length} items with location data • {radiusKm}km radius
      </p>
    </div>
  );
}

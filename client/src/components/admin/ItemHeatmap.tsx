/**
 * Item Heatmap Component
 * Displays lost (red) and found (green) items on an interactive map
 * Uses Leaflet with the existing Geoapify tiles
 */

import { useEffect, useMemo, useRef } from 'react';
import { MapPin, Map as MapIcon, Loader2 } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DashboardStats, MapCenter } from '@/types/domain';

type HeatmapPoint = DashboardStats['heatmapPoints'][number];

interface ItemHeatmapProps {
  radiusKm?: number;
  /** The dashboard is still waiting for its first response. */
  loading?: boolean;
  /**
   * Positions from the dashboard stats endpoint.
   *
   * This component used to read the whole item collection itself, which is one
   * of the seven full-collection client reads PERF-07 is about. It draws what
   * it is given now.
   */
  points: HeatmapPoint[];
  mapCenter?: MapCenter;
}

// Custom marker icons using divIcon for better performance
const createMarkerIcon = (color: string, borderColor: string) =>
  L.divIcon({
    className: 'custom-marker',
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

/** Where the map opens when nothing else says otherwise. */
const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 };

const lostMarkerIcon = createMarkerIcon('#EA4335', '#B91C1C');
const foundMarkerIcon = createMarkerIcon('#34A853', '#166534');

export function ItemHeatmap({
  radiusKm = 2.5,
  loading = false,
  points,
  mapCenter,
}: ItemHeatmapProps) {
  const items = points;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const circleRef = useRef<L.Circle | null>(null);

  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY;

  /**
   * Priority: the configured map centre, then the average of what is on the
   * map, then Bangalore.
   *
   * Memoised on the numbers rather than on the arrays. A silent refresh hands
   * this component new array and object identities every thirty seconds, and
   * the map init effect depends on the centre: recomputing it destroyed and
   * rebuilt the Leaflet map twice a minute, throwing away the admin's pan and
   * zoom and re-fetching every tile.
   */
  const averageLat = items.length
    ? items.reduce((sum, item) => sum + item.lat, 0) / items.length
    : null;
  const averageLng = items.length
    ? items.reduce((sum, item) => sum + item.lng, 0) / items.length
    : null;

  const centerLat = mapCenter?.lat ?? averageLat ?? DEFAULT_CENTER.lat;
  const centerLng = mapCenter?.lng ?? averageLng ?? DEFAULT_CENTER.lng;

  const center = useMemo(() => ({ lat: centerLat, lng: centerLng }), [centerLat, centerLng]);

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
      L.tileLayer(`https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${apiKey}`, {
        maxZoom: 18,
        attribution: '© Geoapify © OpenMapTiles © OpenStreetMap',
      }).addTo(mapRef.current);
    } else {
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(mapRef.current);
    }

    // Add radius circle
    circleRef.current = L.circle([center.lat, center.lng], {
      radius: radiusKm * 1000, // Convert km to meters
      color: '#4285F4',
      fillColor: '#4285F4',
      fillOpacity: 0.08,
      weight: 2,
      dashArray: '8, 8',
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
      const icon = item.type === 'Lost' ? lostMarkerIcon : foundMarkerIcon;
      const marker = L.marker([item.lat, item.lng], { icon }).addTo(mapRef.current!);

      // Create popup content
      const statusColor =
        item.status === 'Matched' ? '#22c55e' : item.status === 'Claimed' ? '#8b5cf6' : '#f59e0b';
      const typeColor = item.type === 'Lost' ? '#EA4335' : '#34A853';

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
            ${item.location || 'No location specified'}
          </div>
        </div>
      `);

      markersRef.current.push(marker);
    });
  }, [items]);

  // Count items by type
  const lostCount = items.filter((i) => i.type === 'Lost').length;
  const foundCount = items.filter((i) => i.type === 'Found').length;

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
          <h3 className="font-semibold text-text-primary">Item Location Heatmap</h3>
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

/**
 * Location Modal - Wraps LocationPicker in a modal for chat use
 */

import { useState } from "react";
import { X, MapPin } from "lucide-react";
import { LazyLocationPicker } from "./LazyLocationPicker";

interface LocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectLocation: (locationName: string) => void;
}

export function LocationModal({
  isOpen,
  onClose,
  onSelectLocation,
}: LocationModalProps) {
  const [selectedLocation, setSelectedLocation] = useState("");

  const handleConfirm = () => {
    if (selectedLocation.trim()) {
      onSelectLocation(selectedLocation.trim());
      onClose();
      setSelectedLocation("");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-[#4285F4]" />
            <h3 className="font-semibold text-text-primary">Select Location</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Location Picker */}
        <div className="p-4">
          <LazyLocationPicker
            value={selectedLocation}
            onChange={setSelectedLocation}
            placeholder="Search for a location..."
          />
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-gray-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl 
                     hover:bg-gray-50 transition-colors font-medium text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedLocation.trim()}
            className="flex-1 py-2.5 bg-[#4285F4] text-white rounded-xl 
                     hover:bg-[#3367D6] transition-colors font-medium
                     disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Location
          </button>
        </div>
      </div>
    </div>
  );
}

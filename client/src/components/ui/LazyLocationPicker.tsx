import { lazy, Suspense } from "react";

const LocationPickerLazy = lazy(() =>
  import("./LocationPicker").then((m) => ({ default: m.LocationPicker })),
);

interface LazyLocationPickerProps {
  value: string;
  onChange: (location: string) => void;
  onLocationSelect?: (
    location: string,
    coordinates: { lat: number; lng: number },
  ) => void;
  placeholder?: string;
}

function LocationPickerSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
      <div className="w-full h-48 bg-gray-100 rounded-lg animate-pulse flex items-center justify-center">
        <div className="text-text-secondary text-sm">Loading map...</div>
      </div>
      <div className="h-4 bg-gray-100 rounded w-48 mx-auto animate-pulse" />
    </div>
  );
}

export function LazyLocationPicker(props: LazyLocationPickerProps) {
  return (
    <Suspense fallback={<LocationPickerSkeleton />}>
      <LocationPickerLazy {...props} />
    </Suspense>
  );
}

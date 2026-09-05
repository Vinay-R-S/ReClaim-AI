import { MapPin, Clock } from '../../lib/icons';
import { LazyLocationPicker } from '../ui/LazyLocationPicker';

interface CameraContextPanelProps {
  location: string;
  coordinates?: { lat: number; lng: number };
  onLocationChange: (location: string, coordinates?: { lat: number; lng: number }) => void;
  /** Only shown for uploaded footage, where the sighting time is not "now". */
  recordedAt?: Date;
  onRecordedAtChange?: (recordedAt: Date) => void;
}

/** `datetime-local` wants local wall-clock time, not an ISO UTC string. */
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Where the camera is and when the footage was taken.
 *
 * Registered detections used to be hardcoded to "Admin Office (CCTV)" with no
 * coordinates and a date of now, so every CCTV item scored zero on location
 * and sat at the edge of the time window: in practice they never matched
 * anything. Both are the admin's to set, once per session.
 */
export function CameraContextPanel({
  location,
  coordinates,
  onLocationChange,
  recordedAt,
  onRecordedAtChange,
}: CameraContextPanelProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
      <div>
        <label className="text-sm font-medium text-text-primary mb-1 block">
          <MapPin className="w-4 h-4 inline mr-1" />
          Camera location <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-text-secondary mb-2">
          Where this camera is pointed. Items registered from a detection are matched against this
          position, so an approximate pin beats no pin.
        </p>
        <LazyLocationPicker
          value={location}
          // Typing clears the pin. Keeping the old coordinates would leave an
          // item labelled "Library Block B" matched against the map centre,
          // and location scoring is coordinate-first, so the text would never
          // get a say. The picker fires this before `onLocationSelect` on a
          // map pick, so choosing a point still ends with real coordinates.
          onChange={(next) => onLocationChange(next, undefined)}
          onLocationSelect={(next, nextCoordinates) => onLocationChange(next, nextCoordinates)}
          placeholder="Where is this camera?"
        />
        {!coordinates && (
          <p className="text-xs text-amber-600 mt-2">
            No coordinates set yet. Pick a point on the map so location scoring can run.
          </p>
        )}
      </div>

      {recordedAt && onRecordedAtChange && (
        <div>
          <label
            htmlFor="cctv-recorded-at"
            className="text-sm font-medium text-text-primary mb-1 block"
          >
            <Clock className="w-4 h-4 inline mr-1" />
            Footage recorded at
          </label>
          <p className="text-xs text-text-secondary mb-2">
            The start of the video. Each keyframe is timestamped from here, so a registered item
            carries the time the object was actually seen.
          </p>
          <input
            id="cctv-recorded-at"
            type="datetime-local"
            value={toLocalInputValue(recordedAt)}
            max={toLocalInputValue(new Date())}
            onChange={(e) => {
              const next = new Date(e.target.value);
              if (!Number.isNaN(next.getTime())) onRecordedAtChange(next);
            }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      )}
    </div>
  );
}

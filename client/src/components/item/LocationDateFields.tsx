import { Calendar, Clock, MapPin } from 'lucide-react';
import { LazyLocationPicker } from '../ui/LazyLocationPicker';
import type { Coordinates } from '../../types/domain';

/**
 * Where and when, for a report.
 *
 * The collection location is the field the two report paths disagreed on: the
 * user modal asks for it on a Found report and the admin one never did, which
 * is why an admin-created found item reached the handover email with no
 * collection point on it.
 */

export interface LocationDateValues {
  location: string;
  coordinates?: Coordinates;
  collectionLocation: string;
  collectionCoordinates?: Coordinates;
  date: string;
  time: string;
}

interface LocationDateFieldsProps {
  type: 'Lost' | 'Found';
  values: LocationDateValues;
  onChange: (patch: Partial<LocationDateValues>) => void;
  /** Found items are collected somewhere; ask unless the caller opts out. */
  askCollectionPoint?: boolean;
}

const INPUT_CLASS =
  'w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary';

export function LocationDateFields({
  type,
  values,
  onChange,
  askCollectionPoint = true,
}: LocationDateFieldsProps) {
  return (
    <>
      <div className="mb-4">
        <label className="text-sm text-text-secondary mb-1 block font-medium">
          <MapPin className="w-4 h-4 inline mr-1" />
          {type === 'Lost' ? 'Last Seen Location' : 'Found Location'}{' '}
          <span className="text-red-500">*</span>
        </label>
        <LazyLocationPicker
          value={values.location}
          onChange={(location) => onChange({ location })}
          onLocationSelect={(location, coordinates) => onChange({ location, coordinates })}
          placeholder={
            type === 'Lost' ? 'Where did you last see this item?' : 'Where did you find this item?'
          }
        />
      </div>

      {type === 'Found' && askCollectionPoint && (
        <div className="mb-4">
          <label className="text-sm text-text-secondary mb-1 block font-medium">
            <MapPin className="w-4 h-4 inline mr-1" />
            Collection Location <span className="text-red-500">*</span>
          </label>
          <LazyLocationPicker
            value={values.collectionLocation}
            onChange={(collectionLocation) => onChange({ collectionLocation })}
            onLocationSelect={(collectionLocation, collectionCoordinates) =>
              onChange({ collectionLocation, collectionCoordinates })
            }
            placeholder="Where can the owner collect this item?"
          />
          <p className="text-xs text-text-secondary mt-1">
            This will only be shared with the verified owner.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-sm text-text-secondary mb-1 block font-medium">
            <Calendar className="w-4 h-4 inline mr-1" />
            Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={values.date}
            onChange={(event) => onChange({ date: event.target.value })}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className="text-sm text-text-secondary mb-1 block font-medium">
            <Clock className="w-4 h-4 inline mr-1" />
            Time (IST)
          </label>
          <input
            type="time"
            value={values.time}
            onChange={(event) => onChange({ time: event.target.value })}
            className={INPUT_CLASS}
          />
        </div>
      </div>
    </>
  );
}

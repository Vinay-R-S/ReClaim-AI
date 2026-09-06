import { useRef } from 'react';
import { Camera, Image as ImageIcon, Loader2, Upload } from 'lucide-react';
import { formatBytes } from '../../lib/imageCompression';
import { MAX_ITEM_IMAGES } from '../../hooks/useItemImages';

/**
 * The image step of a report, shared by the user and admin paths.
 *
 * Both modals grew their own copy of this strip and they had drifted: only one
 * compressed what it picked, and the admin one built its previews from
 * concurrent `FileReader` callbacks, so the order depended on which file
 * decoded first.
 */

interface ImagePickerProps {
  previews: string[];
  errors: string[];
  processing: boolean;
  totalBytes: number;
  required: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  label?: string;
}

export function ImagePicker({
  previews,
  errors,
  processing,
  totalBytes,
  required,
  onAdd,
  onRemove,
  label = 'Item Image',
}: ImagePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);

    // Reset the input up front so the same file can be re-selected after an
    // error, and so it is cleared before any await.
    event.target.value = '';

    if (picked.length > 0) onAdd(picked);
  };

  return (
    <div className="mb-6">
      <label className="text-sm text-text-secondary mb-2 block font-medium">
        {label}
        {previews.length > 1 ? 's' : ''}{' '}
        {required ? (
          <span className="text-red-500">*</span>
        ) : (
          <span className="text-gray-400 text-xs ml-1">(optional)</span>
        )}
        <span className="text-gray-400 text-xs ml-2">
          (Upload up to {MAX_ITEM_IMAGES} images for better analysis)
        </span>
      </label>

      <div
        onClick={() => fileInputRef.current?.click()}
        className="w-full min-h-[160px] border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-blue-50 transition-all overflow-hidden relative p-4"
      >
        {previews.length > 0 ? (
          <div className="w-full">
            <div className="grid grid-cols-3 gap-2">
              {previews.map((preview, index) => (
                <div key={index} className="relative aspect-square">
                  <img
                    src={preview}
                    alt={`Preview ${index + 1}`}
                    className="w-full h-full object-cover rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(index);
                    }}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                    title="Remove image"
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}

              {previews.length < MAX_ITEM_IMAGES && (
                <div className="aspect-square border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50 hover:bg-gray-100">
                  <div className="text-center">
                    <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
                    <span className="text-xs text-gray-500">Add more</span>
                  </div>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500 text-center mt-2">
              {previews.length} image{previews.length > 1 ? 's' : ''} selected (
              {formatBytes(totalBytes)})
            </p>
          </div>
        ) : (
          <>
            <ImageIcon className="w-10 h-10 text-text-secondary mb-2" />
            <p className="text-sm text-text-secondary">
              Click to upload image(s) ({required ? 'required' : 'optional'})
            </p>
            <p className="text-xs text-gray-400 mt-1">Multiple images help AI analyze better</p>
          </>
        )}
      </div>

      {/* Shows on mobile for quick back-camera access */}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          cameraInputRef.current?.click();
        }}
        className="mt-3 w-full py-3 px-4 border-2 border-dashed border-primary/50 rounded-xl flex items-center justify-center gap-2 text-primary hover:bg-primary/5 hover:border-primary transition-all"
      >
        <Camera className="w-5 h-5" />
        <span className="text-sm font-medium">Take Photo with Camera</span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleChange}
        className="hidden"
      />
      {/* `capture` asks a phone for the back camera rather than the gallery */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        className="hidden"
      />

      {processing && (
        <p className="mt-2 text-xs text-text-secondary flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Preparing images...
        </p>
      )}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1">
          {errors.map((error, index) => (
            <li key={index} className="text-xs text-red-600">
              {error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

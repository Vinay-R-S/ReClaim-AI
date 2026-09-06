import { useCallback, useState } from 'react';
import {
  MAX_PAYLOAD_BYTES,
  compressImage,
  isImageFile,
  payloadBytes,
} from '../lib/imageCompression';

/** Images the server accepts on one item. */
export const MAX_ITEM_IMAGES = 5;

interface UseItemImagesOptions {
  /**
   * Images the flow already has, with no `File` behind them. CCTV
   * register-as-found seeds the detected crop this way; picking replaces it.
   */
  seeded?: string[];
}

/**
 * Picking, compressing and holding the images for one item report.
 *
 * `previews` is both what the strip shows and what gets uploaded, because
 * compression happens at selection rather than at submit (defect UI-15): the
 * data URL in the strip is the small version that goes to the server. `files`
 * is the same images as `File`s, which is what the analysis endpoint takes,
 * and it is empty for a seeded image because nobody picked one.
 */
export function useItemImages({ seeded = [] }: UseItemImagesOptions = {}) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>(seeded);
  const [errors, setErrors] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [seedActive, setSeedActive] = useState(seeded.length > 0);

  const add = useCallback(
    async (picked: File[]) => {
      if (picked.length === 0) return;

      // A second selection while the first is still being compressed would be
      // built on a stale list and silently lose images.
      if (processing) {
        setErrors(['Still preparing the previous images. Please try again in a moment.']);
        return;
      }

      // A hand-picked upload replaces the seeded crop, matching what the
      // preview strip then shows.
      const keptFiles = seedActive ? [] : files;
      const keptPreviews = seedActive ? [] : previews;

      const room = MAX_ITEM_IMAGES - keptPreviews.length;
      const nextErrors: string[] = [];

      if (room <= 0) {
        setErrors([`You can attach at most ${MAX_ITEM_IMAGES} images.`]);
        return;
      }

      if (picked.length > room) {
        nextErrors.push(`Only the first ${room} of your ${picked.length} images were added.`);
      }

      setProcessing(true);

      const acceptedFiles = [...keptFiles];
      const acceptedPreviews = [...keptPreviews];

      for (const file of picked.slice(0, room)) {
        if (!isImageFile(file)) {
          nextErrors.push(`${file.name}: not an image file.`);
          continue;
        }

        try {
          // Sequential on purpose: decoding several phone photos onto canvases
          // at once is what makes a mobile browser drop the tab.
          const { file: compressed, dataUrl } = await compressImage(file);

          if (payloadBytes([...acceptedPreviews, dataUrl]) > MAX_PAYLOAD_BYTES) {
            nextErrors.push(`${file.name}: skipped, the report would exceed the upload limit.`);
            continue;
          }

          acceptedFiles.push(compressed);
          acceptedPreviews.push(dataUrl);
        } catch (err) {
          nextErrors.push(
            `${file.name}: ${err instanceof Error ? err.message : 'could not be read'}`,
          );
        }
      }

      // Nothing survived: every file was the wrong type, over the budget or
      // unreadable. Keep what was already there, seeded crop included, rather
      // than clearing the strip and publishing an item with no image at all.
      if (acceptedPreviews.length === 0) {
        setErrors(nextErrors);
        setProcessing(false);
        return;
      }

      setFiles(acceptedFiles);
      setPreviews(acceptedPreviews);
      setErrors(nextErrors);
      setSeedActive(false);
      setProcessing(false);
    },
    [files, previews, processing, seedActive],
  );

  const remove = useCallback(
    (index: number) => {
      setPreviews((current) => current.filter((_, i) => i !== index));
      // A seeded preview has no file behind it, so the two lists only line up
      // once the seed is gone.
      if (!seedActive) setFiles((current) => current.filter((_, i) => i !== index));
      setErrors([]);
    },
    [seedActive],
  );

  return {
    /** The images as `File`s, for the endpoints that analyse them. */
    files,
    /** The images as data URLs: what the strip shows and what gets uploaded. */
    previews,
    errors,
    processing,
    totalBytes: payloadBytes(previews),
    add,
    remove,
    setErrors,
  };
}

/**
 * The image pipeline behind both report forms.
 *
 * Compression happens at selection, so `previews` is both what the strip shows
 * and what gets uploaded. The rules about what survives a bad pick are the
 * part worth pinning down: one of them was a defect twice.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

/** Compression is a canvas operation; jsdom has no canvas. */
const compression = vi.hoisted(() => ({
  compressImage: vi.fn(),
  isImageFile: vi.fn(),
}));

vi.mock('../lib/imageCompression', () => ({
  compressImage: compression.compressImage,
  isImageFile: compression.isImageFile,
  payloadBytes: (urls: string[]) => urls.reduce((total, url) => total + url.length, 0),
  MAX_PAYLOAD_BYTES: 8 * 1024 * 1024,
}));

const { MAX_ITEM_IMAGES, useItemImages } = await import('./useItemImages');

function file(name = 'photo.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

/** A compressed result whose data URL is `size` characters long. */
function compressed(name: string, size = 100) {
  return { file: file(name), dataUrl: `data:image/jpeg;base64,${'a'.repeat(size)}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  compression.isImageFile.mockReturnValue(true);
  compression.compressImage.mockImplementation(async (input: File) => compressed(input.name));
});

describe('adding images', () => {
  it('keeps the compressed file and its data URL', async () => {
    const { result } = renderHook(() => useItemImages());

    await act(async () => {
      await result.current.add([file('one.jpg')]);
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.previews).toHaveLength(1);
    expect(result.current.previews[0]).toMatch(/^data:image\/jpeg/);
  });

  it('appends to what is already there', async () => {
    const { result } = renderHook(() => useItemImages());

    await act(async () => {
      await result.current.add([file('one.jpg')]);
    });
    await act(async () => {
      await result.current.add([file('two.jpg')]);
    });

    expect(result.current.previews).toHaveLength(2);
  });

  it('refuses more than the server accepts, and says so', async () => {
    const { result } = renderHook(() => useItemImages());

    await act(async () => {
      await result.current.add(
        Array.from({ length: MAX_ITEM_IMAGES + 2 }, (_, index) => file(`p${index}.jpg`)),
      );
    });

    expect(result.current.previews).toHaveLength(MAX_ITEM_IMAGES);
    expect(result.current.errors.join(' ')).toMatch(/Only the first/);
  });

  it('names the file it rejected rather than failing the whole pick', async () => {
    compression.isImageFile.mockImplementation((input: File) => input.name !== 'notes.pdf');

    const { result } = renderHook(() => useItemImages());

    await act(async () => {
      await result.current.add([file('good.jpg'), file('notes.pdf')]);
    });

    expect(result.current.previews).toHaveLength(1);
    expect(result.current.errors.join(' ')).toMatch(/notes\.pdf/);
  });

  it('reports a file that could not be read, by name', async () => {
    compression.compressImage.mockRejectedValueOnce(new Error('This image is too large'));

    const { result } = renderHook(() => useItemImages());

    await act(async () => {
      await result.current.add([file('huge.jpg')]);
    });

    expect(result.current.previews).toHaveLength(0);
    expect(result.current.errors.join(' ')).toMatch(/huge\.jpg: This image is too large/);
  });

  /**
   * The budget is what stands between a five-photo report and a 413 that the
   * UI used to surface as a generic failure.
   */
  it('skips an image that would push the report over the upload limit', async () => {
    compression.compressImage.mockImplementation(async (input: File) =>
      compressed(input.name, 5 * 1024 * 1024),
    );

    const { result } = renderHook(() => useItemImages());

    await act(async () => {
      await result.current.add([file('one.jpg'), file('two.jpg')]);
    });

    expect(result.current.previews).toHaveLength(1);
    expect(result.current.errors.join(' ')).toMatch(/upload limit/);
  });
});

describe('a seeded image', () => {
  const SEED = 'data:image/jpeg;base64,seeded';

  /**
   * UI-03: CCTV register-as-found hands the detected crop in as a preview.
   * Submission only ever uploaded picked files, so the admin saw the crop on
   * screen and the created item had no images at all.
   */
  it('UI-03 is part of the upload payload, not just the strip', () => {
    const { result } = renderHook(() => useItemImages({ seeded: [SEED] }));

    expect(result.current.previews).toEqual([SEED]);
  });

  it('has no file behind it, because nobody picked one', () => {
    const { result } = renderHook(() => useItemImages({ seeded: [SEED] }));

    expect(result.current.files).toHaveLength(0);
  });

  it('is replaced by a hand-picked upload', async () => {
    const { result } = renderHook(() => useItemImages({ seeded: [SEED] }));

    await act(async () => {
      await result.current.add([file('mine.jpg')]);
    });

    expect(result.current.previews).toHaveLength(1);
    expect(result.current.previews[0]).not.toBe(SEED);
  });

  /**
   * A pick where nothing was accepted must not take the crop with it: that is
   * the defect the seeding exists to prevent, reintroduced from the other side.
   */
  it('survives a pick that accepted nothing', async () => {
    compression.isImageFile.mockReturnValue(false);

    const { result } = renderHook(() => useItemImages({ seeded: [SEED] }));

    await act(async () => {
      await result.current.add([file('notes.pdf')]);
    });

    expect(result.current.previews).toEqual([SEED]);
    expect(result.current.errors).not.toHaveLength(0);
  });
});

describe('removing an image', () => {
  it('drops the preview and its file together', async () => {
    const { result } = renderHook(() => useItemImages());

    await act(async () => {
      await result.current.add([file('one.jpg'), file('two.jpg')]);
    });

    act(() => result.current.remove(0));

    await waitFor(() => expect(result.current.previews).toHaveLength(1));
    expect(result.current.files).toHaveLength(1);
  });

  it('clears stale errors, which no longer describe what is there', async () => {
    compression.isImageFile.mockImplementation((input: File) => input.name !== 'bad.pdf');

    const { result } = renderHook(() => useItemImages());

    await act(async () => {
      await result.current.add([file('one.jpg'), file('bad.pdf')]);
    });

    expect(result.current.errors).not.toHaveLength(0);

    act(() => result.current.remove(0));

    await waitFor(() => expect(result.current.errors).toHaveLength(0));
  });
});

/**
 * Test environment setup.
 *
 * jsdom implements the DOM but not everything a browser gives a component, so
 * the few things our code touches are stubbed here rather than in each file.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// `Feedback` scrolls itself into view; jsdom has no layout to scroll.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Leaflet and the canvas-based image compression both reach for these.
window.matchMedia =
  window.matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

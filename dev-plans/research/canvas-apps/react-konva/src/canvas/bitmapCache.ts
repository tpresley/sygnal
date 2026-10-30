// Konva's node caching: draw a group once into an offscreen canvas and blit it
// while it only translates (drag) or the camera moves (pan/zoom). `?nocache`
// turns it off, to compare against plain redraws.
import type Konva from 'konva';

export const CACHE_ENABLED = typeof location === 'undefined' || !new URLSearchParams(location.search).has('nocache');
/** Below this many nodes a full redraw is cheaper than building the bitmap. */
export const CACHE_MIN_NODES = 300;
const MAX_SIDE = 8192;
const MAX_PIXELS = 24e6;

/**
 * Caches `group` at the current screen resolution. Returns false (and does
 * nothing) when the bitmap would be too large, e.g. a big selection zoomed in.
 */
export function cacheAtScreenResolution(group: Konva.Group, scale: number): boolean {
  const r = group.getClientRect({ skipTransform: true });
  const pixelRatio = scale * (window.devicePixelRatio || 1);
  const w = r.width * pixelRatio, h = r.height * pixelRatio;
  if (!(w > 0 && h > 0) || w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) return false;
  group.cache({ pixelRatio });
  return true;
}

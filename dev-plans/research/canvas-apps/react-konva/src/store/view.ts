// Transient UI state, split by update frequency so subscribers only wake for
// what they show: the camera (every wheel event), the overlay (every drag
// frame) and the session (a few times per gesture).
import { create } from 'zustand';
import type { Point, Rect } from '../model/geometry';
import type { Guide } from '../model/snapping';

export interface Camera { x: number; y: number; scale: number }
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

interface CameraState extends Camera {
  setCamera(c: Partial<Camera>): void;
  /** Zooms by `factor` keeping the screen point `at` fixed. */
  zoomAt(at: Point, factor: number): void;
  panBy(dx: number, dy: number): void;
}

export const useCamera = create<CameraState>()((set, get) => ({
  x: 0, y: 0, scale: 1,
  setCamera: (c) => set(c),
  zoomAt: (at, factor) => {
    const { x, y, scale } = get();
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * factor));
    const k = next / scale;
    set({ scale: next, x: at.x - (at.x - x) * k, y: at.y - (at.y - y) * k });
  },
  panBy: (dx, dy) => set((s) => ({ x: s.x + dx, y: s.y + dy })),
}));

export const screenToWorld = (p: Point, c: Camera = useCamera.getState()): Point =>
  ({ x: (p.x - c.x) / c.scale, y: (p.y - c.y) / c.scale });
export const worldToScreen = (p: Point, c: Camera = useCamera.getState()): Point =>
  ({ x: p.x * c.scale + c.x, y: p.y * c.scale + c.y });

/** Fits a world rect into a viewport of the given size. */
export function cameraToFit(r: Rect, width: number, height: number, padding = 40): Camera {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
    Math.min((width - padding * 2) / Math.max(r.w, 1), (height - padding * 2) / Math.max(r.h, 1))));
  return { scale, x: width / 2 - (r.x + r.w / 2) * scale, y: height / 2 - (r.y + r.h / 2) * scale };
}

interface OverlayState {
  guides: Guide[];
  marquee: Rect | null;
  /** Shape being drawn with a creation tool, in world space. */
  draft: Rect | null;
  /** World delta of the drag in progress (for the properties panel's live X/Y). */
  dragDelta: Point | null;
  /** Selection bounds at drag start; the overlay draws them offset by dragDelta. */
  dragBounds: Rect | null;
  set(p: Partial<Omit<OverlayState, 'set'>>): void;
}
export const useOverlay = create<OverlayState>()((set) => ({
  guides: [], marquee: null, draft: null, dragDelta: null, dragBounds: null,
  set: (p) => set(p),
}));

interface SessionState {
  /** Ids rendered in the drag layer instead of the static layer while a drag runs. */
  dragging: ReadonlySet<string> | null;
  editingTextId: string | null;
  spaceDown: boolean;
  panning: boolean;
  set(p: Partial<Omit<SessionState, 'set'>>): void;
}
export const useSession = create<SessionState>()((set) => ({
  dragging: null, editingTextId: null, spaceDown: false, panning: false,
  set: (p) => set(p),
}));

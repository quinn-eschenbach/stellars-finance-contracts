import type { AppKind } from "./wm";

export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const STORAGE_KEY = "w95.geometry.v1";

interface Size {
  width: number;
  height: number;
}

export const DEFAULT_SIZE: Record<AppKind, Size> = {
  trade: { width: 880, height: 600 },
  vault: { width: 560, height: 580 },
  faucet: { width: 400, height: 380 },
  profile: { width: 680, height: 500 },
  leaderboard: { width: 720, height: 460 },
};

export const MIN_SIZE: Record<AppKind, Size> = {
  trade: { width: 480, height: 360 },
  vault: { width: 360, height: 320 },
  faucet: { width: 320, height: 280 },
  profile: { width: 400, height: 280 },
  leaderboard: { width: 440, height: 240 },
};

function readStore(): Record<string, Geometry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Geometry>) : {};
  } catch {
    return {};
  }
}

export function loadGeometry(id: string): Geometry | null {
  return readStore()[id] ?? null;
}

export function saveGeometry(id: string, geom: Geometry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStore(), [id]: geom }));
  } catch {
    // Storage full / disabled — geometry just won't persist.
  }
}

/**
 * Cascade placement for windows without a saved geometry, clamped to the
 * desktop area so a window never spawns under the taskbar or off-screen.
 */
export function defaultGeometry(kind: AppKind, index: number, desktop: Size): Geometry {
  const size = DEFAULT_SIZE[kind];
  const width = Math.min(size.width, Math.max(MIN_SIZE[kind].width, desktop.width - 16));
  const height = Math.min(size.height, Math.max(MIN_SIZE[kind].height, desktop.height - 16));
  const step = 28;
  const maxX = Math.max(0, desktop.width - width);
  const maxY = Math.max(0, desktop.height - height);
  const offset = step * (index % 8);
  return {
    x: Math.min(48 + offset, maxX),
    y: Math.min(24 + offset, maxY),
    width,
    height,
  };
}

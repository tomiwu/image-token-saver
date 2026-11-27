import type { Point, Size } from "./types.ts";

const ITERATIONS = 8;

function centre(size: Size): Point {
  return [(size.width - 1) / 2, (size.height - 1) / 2];
}

function radius(size: Size): number {
  return Math.hypot(size.width, size.height) / 2;
}

export function undistortPoint(point: Point, k1: number, size: Size): Point {
  if (k1 === 0) {
    return point;
  }
  const [cx, cy] = centre(size);
  const dx = point[0] - cx;
  const dy = point[1] - cy;
  const r = radius(size);
  const factor = 1 + k1 * ((dx * dx + dy * dy) / (r * r));
  return [cx + dx * factor, cy + dy * factor];
}

export function distortPoint(point: Point, k1: number, size: Size): Point {
  if (k1 === 0) {
    return point;
  }
  const [cx, cy] = centre(size);
  const ux = point[0] - cx;
  const uy = point[1] - cy;
  const r = radius(size);
  let dx = ux;
  let dy = uy;
  for (let i = 0; i < ITERATIONS; i++) {
    const factor = 1 + k1 * ((dx * dx + dy * dy) / (r * r));
    dx = ux / factor;
    dy = uy / factor;
  }
  return [cx + dx, cy + dy];
}

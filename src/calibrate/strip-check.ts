import { SIDES, type Side } from "./types.ts";
import type { RawImage } from "./warp.ts";

export const DEVIATION_LEVEL = 60;
export const MAX_DEVIANT_FRACTION = 0.6;

export interface StripReport {
  side: Side;
  fraction: number;
  clean: boolean;
}

function luma(image: RawImage, x: number, y: number): number {
  const i = (y * image.width + x) * 3;
  return (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function backgroundLevel(image: RawImage): number {
  const values: number[] = [];
  const x0 = Math.floor(image.width * 0.25);
  const y0 = Math.floor(image.height * 0.25);
  for (let y = y0; y < image.height - y0; y += 2) {
    for (let x = x0; x < image.width - x0; x += 2) {
      values.push(luma(image, x, y));
    }
  }
  return median(values);
}

function stripBounds(side: Side, image: RawImage, depth: number) {
  const bounds = {
    top: { x0: 0, x1: image.width, y0: 0, y1: depth },
    bottom: {
      x0: 0,
      x1: image.width,
      y0: image.height - depth,
      y1: image.height,
    },
    left: { x0: 0, x1: depth, y0: 0, y1: image.height },
    right: {
      x0: image.width - depth,
      x1: image.width,
      y0: 0,
      y1: image.height,
    },
  };
  return bounds[side];
}

function deviantFraction(
  image: RawImage,
  side: Side,
  depth: number,
  background: number,
): number {
  const b = stripBounds(side, image, depth);
  let deviant = 0;
  let count = 0;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      deviant +=
        Math.abs(luma(image, x, y) - background) > DEVIATION_LEVEL ? 1 : 0;
      count++;
    }
  }
  return deviant / count;
}

export function edgeStripReport(image: RawImage): StripReport[] {
  const depth = Math.max(2, Math.round(image.width * 0.01));
  const background = backgroundLevel(image);
  return SIDES.map((side) => {
    const fraction = deviantFraction(image, side, depth, background);
    return { side, fraction, clean: fraction <= MAX_DEVIANT_FRACTION };
  });
}

export function allStripsClean(reports: StripReport[]): boolean {
  return reports.every((r) => r.clean);
}

import type { GrayImage } from "./mask.ts";

export interface Gradients {
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
}

export interface EdgePeak {
  x: number;
  y: number;
  gx: number;
  gy: number;
  mag: number;
}

function at(image: GrayImage, x: number, y: number): number {
  return image.data[y * image.width + x];
}

export function sobelX(image: GrayImage, x: number, y: number): number {
  return (
    at(image, x + 1, y - 1) +
    2 * at(image, x + 1, y) +
    at(image, x + 1, y + 1) -
    at(image, x - 1, y - 1) -
    2 * at(image, x - 1, y) -
    at(image, x - 1, y + 1)
  );
}

export function sobelY(image: GrayImage, x: number, y: number): number {
  return (
    at(image, x - 1, y + 1) +
    2 * at(image, x, y + 1) +
    at(image, x + 1, y + 1) -
    at(image, x - 1, y - 1) -
    2 * at(image, x, y - 1) -
    at(image, x + 1, y - 1)
  );
}

export function computeGradients(image: GrayImage): Gradients {
  const gx = new Float32Array(image.data.length);
  const gy = new Float32Array(image.data.length);
  const mag = new Float32Array(image.data.length);
  for (let y = 1; y < image.height - 1; y++) {
    fillGradientRow(image, y, gx, gy, mag);
  }
  return { gx, gy, mag };
}

function fillGradientRow(
  image: GrayImage,
  y: number,
  gx: Float32Array,
  gy: Float32Array,
  mag: Float32Array,
): void {
  for (let x = 1; x < image.width - 1; x++) {
    const i = y * image.width + x;
    gx[i] = sobelX(image, x, y);
    gy[i] = sobelY(image, x, y);
    mag[i] = Math.hypot(gx[i], gy[i]);
  }
}

export function maxValue(values: Float32Array): number {
  let max = 0;
  for (const value of values) {
    if (value > max) {
      max = value;
    }
  }
  return max;
}

export function quantile(values: Float32Array, q: number): number {
  const max = maxValue(values);
  if (max <= 0) {
    return 0;
  }
  const bins = 256;
  const hist = new Uint32Array(bins);
  const count = fillMagHist(hist, values, max, bins);
  return quantileFromHist(hist, count, q, max);
}

function fillMagHist(
  hist: Uint32Array,
  values: Float32Array,
  max: number,
  bins: number,
): number {
  let count = 0;
  for (const value of values) {
    count += addHistBin(hist, value, max, bins);
  }
  return count;
}

function addHistBin(
  hist: Uint32Array,
  value: number,
  max: number,
  bins: number,
): number {
  if (value <= 0) {
    return 0;
  }
  hist[Math.min(bins - 1, Math.floor((value / max) * bins))]++;
  return 1;
}

function quantileFromHist(
  hist: Uint32Array,
  count: number,
  q: number,
  max: number,
): number {
  const target = count * q;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= target) {
      return ((i + 0.5) / hist.length) * max;
    }
  }
  return max;
}

export function magnitudeThreshold(mag: Float32Array): number {
  return Math.max(6, Math.min(40, quantile(mag, 0.8) * 0.3));
}

export function subpixelOffset(
  left: number,
  mid: number,
  right: number,
): number {
  const denom = left - 2 * mid + right;
  if (Math.abs(denom) < 1e-6) {
    return 0;
  }
  return (0.5 * (left - right)) / denom;
}

function peakIndex(
  mag: Float32Array,
  width: number,
  x: number,
  y: number,
): number {
  return y * width + x;
}

function isLocalMax(
  mag: Float32Array,
  i: number,
  neighbor: number,
  other: number,
): boolean {
  return mag[i] >= mag[neighbor] && mag[i] >= mag[other];
}

function verticalPeak(
  gradients: Gradients,
  width: number,
  x: number,
  y: number,
  thresh: number,
): EdgePeak | undefined {
  const i = peakIndex(gradients.mag, width, x, y);
  if (gradients.mag[i] < thresh) {
    return undefined;
  }
  if (Math.abs(gradients.gx[i]) < Math.abs(gradients.gy[i])) {
    return undefined;
  }
  if (!isLocalMax(gradients.mag, i, i - 1, i + 1)) {
    return undefined;
  }
  const dx = subpixelOffset(
    gradients.mag[i - 1],
    gradients.mag[i],
    gradients.mag[i + 1],
  );
  return {
    x: x + dx,
    y,
    gx: gradients.gx[i],
    gy: gradients.gy[i],
    mag: gradients.mag[i],
  };
}

function horizontalPeak(
  gradients: Gradients,
  width: number,
  x: number,
  y: number,
  thresh: number,
): EdgePeak | undefined {
  const i = peakIndex(gradients.mag, width, x, y);
  if (gradients.mag[i] < thresh) {
    return undefined;
  }
  if (Math.abs(gradients.gy[i]) < Math.abs(gradients.gx[i])) {
    return undefined;
  }
  if (!isLocalMax(gradients.mag, i, i - width, i + width)) {
    return undefined;
  }
  const dy = subpixelOffset(
    gradients.mag[i - width],
    gradients.mag[i],
    gradients.mag[i + width],
  );
  return {
    x,
    y: y + dy,
    gx: gradients.gx[i],
    gy: gradients.gy[i],
    mag: gradients.mag[i],
  };
}

export interface PeakSet {
  vertical: EdgePeak[];
  horizontal: EdgePeak[];
}

export function collectPeaks(
  image: GrayImage,
  gradients: Gradients,
  thresh: number,
  step = 1,
): PeakSet {
  const peaks: PeakSet = { vertical: [], horizontal: [] };
  for (let y = 1; y < image.height - 1; y += step) {
    collectRow(image, gradients, y, thresh, step, peaks);
  }
  return peaks;
}

function collectRow(
  image: GrayImage,
  gradients: Gradients,
  y: number,
  thresh: number,
  step: number,
  peaks: PeakSet,
): void {
  for (let x = 1; x < image.width - 1; x += step) {
    pushPeak(
      peaks.vertical,
      verticalPeak(gradients, image.width, x, y, thresh),
    );
    pushPeak(
      peaks.horizontal,
      horizontalPeak(gradients, image.width, x, y, thresh),
    );
  }
}

function pushPeak(list: EdgePeak[], peak: EdgePeak | undefined): void {
  if (peak) {
    list.push(peak);
  }
}

export function magAt(
  gradients: Gradients,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }
  return gradients.mag[y * width + x];
}

export function windowMax(
  gradients: Gradients,
  width: number,
  height: number,
  x: number,
  y: number,
  band: number,
): number {
  let max = 0;
  for (let yy = y - band; yy <= y + band; yy++) {
    max = Math.max(max, rowMax(gradients, width, height, x, yy, band));
  }
  return max;
}

function rowMax(
  gradients: Gradients,
  width: number,
  height: number,
  x: number,
  y: number,
  band: number,
): number {
  let max = 0;
  for (let xx = x - band; xx <= x + band; xx++) {
    max = Math.max(max, magAt(gradients, width, height, xx, y));
  }
  return max;
}

import sharp from "sharp";
import type { Point, Side, Size } from "./types.ts";

export interface GrayImage extends Size {
  data: Uint8Array;
}

export async function loadGray(input: Uint8Array): Promise<GrayImage> {
  const { data, info } = await sharp(input)
    .greyscale()
    .blur(1.5)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function histogram(data: Uint8Array): number[] {
  const bins = new Array<number>(256).fill(0);
  for (const value of data) {
    bins[value]++;
  }
  return bins;
}

export function otsuThreshold(data: Uint8Array): number {
  const bins = histogram(data);
  const total = data.length;
  let sumAll = 0;
  bins.forEach((count, level) => {
    sumAll += count * level;
  });
  let weightBack = 0;
  let sumBack = 0;
  let bestScore = -1;
  let best = 0;
  for (let level = 0; level < 256; level++) {
    weightBack += bins[level];
    sumBack += bins[level] * level;
    const weightFront = total - weightBack;
    if (weightBack === 0 || weightFront === 0) {
      continue;
    }
    const meanDiff = sumBack / weightBack - (sumAll - sumBack) / weightFront;
    const score = weightBack * weightFront * meanDiff * meanDiff;
    if (score > bestScore) {
      bestScore = score;
      best = level;
    }
  }
  return best;
}

export function thresholdMask(
  image: GrayImage,
  light: boolean,
  level: number,
): Uint8Array {
  const mask = new Uint8Array(image.data.length);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = image.data[i] > level === light ? 1 : 0;
  }
  return mask;
}

function neighbours(index: number, size: Size): number[] {
  const x = index % size.width;
  const result: number[] = [];
  if (x > 0) result.push(index - 1);
  if (x < size.width - 1) result.push(index + 1);
  if (index >= size.width) result.push(index - size.width);
  if (index < size.width * (size.height - 1)) result.push(index + size.width);
  return result;
}

function flood(
  mask: Uint8Array,
  seen: Uint8Array,
  start: number,
  size: Size,
  wanted: number,
): number[] {
  const stack = [start];
  const members: number[] = [];
  seen[start] = 1;
  while (stack.length > 0) {
    const index = stack.pop() as number;
    members.push(index);
    for (const next of neighbours(index, size)) {
      if (!seen[next] && mask[next] === wanted) {
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return members;
}

function largestRegion(mask: Uint8Array, size: Size): number[] {
  const seen = new Uint8Array(mask.length);
  let best: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1 && !seen[i]) {
      const members = flood(mask, seen, i, size, 1);
      best = members.length > best.length ? members : best;
    }
  }
  return best;
}

export function largestComponent(
  mask: Uint8Array,
  size: Size,
): Uint8Array | undefined {
  const best = largestRegion(mask, size);
  if (best.length === 0) {
    return undefined;
  }
  const result = new Uint8Array(mask.length);
  for (const index of best) {
    result[index] = 1;
  }
  return result;
}

function borderIndices(size: Size): number[] {
  const border: number[] = [];
  for (let x = 0; x < size.width; x++) {
    border.push(x, (size.height - 1) * size.width + x);
  }
  for (let y = 0; y < size.height; y++) {
    border.push(y * size.width, y * size.width + size.width - 1);
  }
  return border;
}

export function fillHoles(component: Uint8Array, size: Size): Uint8Array {
  const seen = new Uint8Array(component.length);
  for (const start of borderIndices(size)) {
    if (component[start] === 0 && !seen[start]) {
      flood(component, seen, start, size, 0);
    }
  }
  return component.map((value, i) => (value === 1 || !seen[i] ? 1 : 0));
}

export function boundaryPoints(mask: Uint8Array, size: Size): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) {
      const x = i % size.width;
      const y = Math.floor(i / size.width);
      for (const next of neighbours(i, size)) {
        if (mask[next] === 0) {
          const nx = next % size.width;
          const ny = Math.floor(next / size.width);
          points.push([(x + nx) / 2, (y + ny) / 2]);
        }
      }
    }
  }
  return points;
}

export function maskArea(mask: Uint8Array): number {
  let area = 0;
  for (const value of mask) {
    area += value;
  }
  return area;
}

interface Integrals {
  count: Float64Array;
  sumX: Float64Array;
  sumY: Float64Array;
}

function buildIntegrals(mask: Uint8Array, size: Size): Integrals {
  const stride = size.width + 1;
  const make = () => new Float64Array(stride * (size.height + 1));
  const result = { count: make(), sumX: make(), sumY: make() };
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const value = mask[y * size.width + x];
      const here = (y + 1) * stride + x + 1;
      const up = y * stride + x + 1;
      const left = (y + 1) * stride + x;
      const diagonal = y * stride + x;
      const parts = [value, value * x, value * y];
      [result.count, result.sumX, result.sumY].forEach((table, i) => {
        table[here] = parts[i] + table[up] + table[left] - table[diagonal];
      });
    }
  }
  return result;
}

function windowSum(table: Float64Array, size: Size, box: number[]): number {
  const stride = size.width + 1;
  const [x0, y0, x1, y1] = box;
  return (
    table[y1 * stride + x1] -
    table[y0 * stride + x1] -
    table[y1 * stride + x0] +
    table[y0 * stride + x0]
  );
}

function sideFromNormal(nx: number, ny: number): Side {
  if (Math.abs(nx) > Math.abs(ny)) {
    return nx > 0 ? "right" : "left";
  }
  return ny > 0 ? "bottom" : "top";
}

const NORMAL_RADIUS = 10;

export function sideLabels(
  mask: Uint8Array,
  size: Size,
  points: Point[],
): Side[] {
  const tables = buildIntegrals(mask, size);
  return points.map(([px, py]) => {
    const cx = Math.round(px);
    const cy = Math.round(py);
    const box = [
      Math.max(0, cx - NORMAL_RADIUS),
      Math.max(0, cy - NORMAL_RADIUS),
      Math.min(size.width, cx + NORMAL_RADIUS + 1),
      Math.min(size.height, cy + NORMAL_RADIUS + 1),
    ];
    const count = Math.max(windowSum(tables.count, size, box), 1);
    const meanX = windowSum(tables.sumX, size, box) / count;
    const meanY = windowSum(tables.sumY, size, box) / count;
    return sideFromNormal(px - meanX, py - meanY);
  });
}

import { undistortPoint } from "./distortion.ts";
import { fitQuad, type QuadFit, type SidePoints } from "./line-fit.ts";
import {
  boundaryPoints,
  fillHoles,
  largestComponent,
  maskArea,
  otsuThreshold,
  sideLabels,
  thresholdMask,
  type GrayImage,
} from "./mask.ts";
import {
  CalibrationError,
  SIDES,
  cornerList,
  type Corners,
  type Point,
  type Side,
} from "./types.ts";

export type Panel = "auto" | "light" | "dark";

export interface Detection {
  corners: Corners;
  k1: number;
  edgePoints: SidePoints;
  fill: number;
  rms: number;
}

export const K1_MIN_GAIN = 0.05;
const K1_STEP = 0.02;
const K1_STEPS = 10;
const EDGE_POINT_LIMIT = 60;

export function polygonArea(corners: Corners): number {
  const points = cornerList(corners);
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(sum) / 2;
}

function undistortAll(points: Point[], k1: number, size: GrayImage): Point[] {
  return points.map((p) => undistortPoint(p, k1, size));
}

function tryFit(points: Point[], labels: Side[], k1: number, size: GrayImage) {
  try {
    return fitQuad(undistortAll(points, k1, size), labels);
  } catch {
    return undefined;
  }
}

export function chooseK1(
  points: Point[],
  labels: Side[],
  size: GrayImage,
  baseline: QuadFit,
): { k1: number; fit: QuadFit } {
  let best = { k1: 0, fit: baseline };
  for (let step = -K1_STEPS; step <= K1_STEPS; step++) {
    const k1 = Math.round(step * K1_STEP * 1e6) / 1e6;
    const fit = tryFit(points, labels, k1, size);
    if (fit && fit.rms < best.fit.rms) {
      best = { k1, fit };
    }
  }
  return baseline.rms - best.fit.rms >= K1_MIN_GAIN
    ? best
    : { k1: 0, fit: baseline };
}

function subsample(points: Point[]): Point[] {
  const stride = Math.max(1, Math.floor(points.length / EDGE_POINT_LIMIT));
  return points.filter((_, i) => i % stride === 0);
}

export function sampleEdgePoints(sides: SidePoints): SidePoints {
  return Object.fromEntries(
    SIDES.map((side: Side) => [side, subsample(sides[side])]),
  ) as SidePoints;
}

function detectPolarity(
  gray: GrayImage,
  light: boolean,
): Detection | undefined {
  const mask = thresholdMask(gray, light, otsuThreshold(gray.data));
  const component = largestComponent(mask, gray);
  if (!component) {
    return undefined;
  }
  const filled = fillHoles(component, gray);
  const points = boundaryPoints(filled, gray);
  const labels = sideLabels(filled, gray, points);
  const baseline = tryFit(points, labels, 0, gray);
  if (!baseline) {
    return undefined;
  }
  const { k1, fit } = chooseK1(points, labels, gray, baseline);
  const fill = maskArea(filled) / Math.max(polygonArea(fit.corners), 1);
  return {
    corners: fit.corners,
    k1,
    edgePoints: sampleEdgePoints(fit.sides),
    fill,
    rms: fit.rms,
  };
}

function closeness(detection: Detection): number {
  return Math.min(detection.fill, 1 / detection.fill);
}

export function detectPanel(gray: GrayImage, panel: Panel): Detection {
  const polarities = panel === "auto" ? [true, false] : [panel === "light"];
  const found = polarities
    .map((light) => detectPolarity(gray, light))
    .filter((d): d is Detection => d !== undefined);
  if (found.length === 0) {
    throw new CalibrationError(
      "The screen was not found in the frame. Check the camera view and the lighting.",
    );
  }
  return found.reduce((best, d) => (closeness(d) > closeness(best) ? d : best));
}

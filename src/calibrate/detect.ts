import {
  chooseK1,
  sampleEdgePoints,
  type Detection,
  type Panel,
} from "./detect-k1.ts";
import {
  detectHairlines,
  hairlineError,
  interiorMean,
  polarityOk,
  type HairlineHit,
} from "./hairlines.ts";
import type { SidePoints } from "./line-fit.ts";
import type { GrayImage } from "./mask.ts";
import { DEFAULT_ASPECT, SIDES, type Point, type Side } from "./types.ts";

export type { Detection, Panel } from "./detect-k1.ts";
export { chooseK1, polygonArea, sampleEdgePoints } from "./detect-k1.ts";

function flattenSides(sides: SidePoints): { points: Point[]; labels: Side[] } {
  const points: Point[] = [];
  const labels: Side[] = [];
  for (const side of SIDES) {
    appendSide(sides, side, points, labels);
  }
  return { points, labels };
}

function appendSide(
  sides: SidePoints,
  side: Side,
  points: Point[],
  labels: Side[],
): void {
  for (const point of sides[side]) {
    points.push(point);
    labels.push(side);
  }
}

function k1Source(loose: SidePoints, tight: SidePoints): SidePoints {
  const count = SIDES.reduce((sum, side) => sum + loose[side].length, 0);
  return count >= 32 ? loose : tight;
}

export function detectPanel(
  gray: GrayImage,
  panel: Panel,
  aspect = DEFAULT_ASPECT,
): Detection {
  const found = detectHairlines(gray, aspect);
  if (!found) {
    throw hairlineError();
  }
  if (!polarityOk(panel, interiorMean(gray, found.corners))) {
    throw hairlineError();
  }
  return withOptionalK1(found, gray);
}

function hairlineDetection(found: HairlineHit): Detection {
  return {
    corners: found.corners,
    k1: 0,
    edgePoints: sampleEdgePoints(found.edgePoints),
    fill: 1,
    rms: found.rms,
  };
}

function withOptionalK1(found: HairlineHit, gray: GrayImage): Detection {
  const sides = k1Source(found.loosePoints, found.edgePoints);
  const loose = flattenSides(sides);
  const chosen = chooseK1(loose.points, loose.labels, gray, {
    corners: found.corners,
    sides,
    rms: found.rms,
  });
  if (chosen.k1 === 0) {
    return hairlineDetection(found);
  }
  return {
    corners: chosen.fit.corners,
    k1: chosen.k1,
    edgePoints: sampleEdgePoints(chosen.fit.sides),
    fill: 1,
    rms: chosen.fit.rms,
  };
}

import {
  applyHomography,
  homographyToCorners,
  invertHomography,
} from "./homography.ts";
import { fitLine, rmsResidual } from "./line-fit.ts";
import {
  CalibrationError,
  CORNER_NAMES,
  SIDES,
  VIEW_WIDTH,
  cornerList,
  rectCorners,
  viewSize,
  type CheckResult,
  type Corners,
  type Point,
  type Side,
  type Size,
} from "./types.ts";
import type { SidePoints } from "./line-fit.ts";

export const CORNER_MARGIN_PX = 12;
export const MAX_ANGLE_DEG = 1;
export const MAX_LINE_RMS_PX = 2;
const ASPECT_TOLERANCE = 0.01;

export interface CheckInput {
  corners: Corners;
  capture: Size;
  target: Size;
  aspect: number;
  edgePoints: SidePoints;
}

function overflow(point: Point, capture: Size): number {
  return Math.max(
    -point[0],
    point[0] - capture.width,
    -point[1],
    point[1] - capture.height,
    0,
  );
}

export function checkCorners(
  corners: Corners,
  capture: Size,
  margin = CORNER_MARGIN_PX,
): CheckResult {
  const failed = CORNER_NAMES.map((name) => ({
    name,
    amount: overflow(corners[name], capture),
  })).filter((entry) => entry.amount > margin);
  const detail =
    failed.length === 0
      ? `all corners are inside the frame (margin ${margin} px)`
      : failed
          .map(
            (f) =>
              `corner ${f.name.toUpperCase()} is ${f.amount.toFixed(1)} px outside the frame (limit ${margin} px)`,
          )
          .join("; ");
  return { name: "corners-in-frame", pass: failed.length === 0, detail };
}

function crossAt(points: Point[], i: number): number {
  const a = points[i];
  const b = points[(i + 1) % points.length];
  const c = points[(i + 2) % points.length];
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}

export function checkConvex(corners: Corners): CheckResult {
  const points = cornerList(corners);
  const signs = points.map((_, i) => Math.sign(crossAt(points, i)));
  const pass = signs.every((s) => s !== 0 && s === signs[0]);
  return {
    name: "convex",
    pass,
    detail: pass ? "the quad is convex" : "the quad is not convex",
  };
}

export function checkAspect(target: Size, aspect: number): CheckResult {
  const actual = target.width / target.height;
  const pass = Math.abs(actual - aspect) / aspect <= ASPECT_TOLERANCE;
  return {
    name: "aspect",
    pass,
    detail: `target aspect ${actual.toFixed(4)}, wanted ${aspect.toFixed(4)}`,
  };
}

function sideAngle(side: Side, dx: number, dy: number): number {
  const horizontal = side === "top" || side === "bottom";
  const degrees = Math.abs(
    (Math.atan2(horizontal ? dy : dx, horizontal ? dx : dy) * 180) / Math.PI,
  );
  return Math.min(degrees, 180 - degrees);
}

export function straightness(
  corners: Corners,
  target: Size,
  edgePoints: SidePoints,
): { side: Side; angle: number; rms: number }[] {
  const view = viewSize(target, VIEW_WIDTH);
  const h = invertHomography(homographyToCorners(rectCorners(view), corners));
  return SIDES.map((side) => {
    const mapped = edgePoints[side].map((p) => applyHomography(h, p));
    const line = fitLine(mapped);
    return {
      side,
      angle: sideAngle(side, line.dx, line.dy),
      rms: rmsResidual(line, mapped),
    };
  });
}

export function checkStraight(
  corners: Corners,
  target: Size,
  edgePoints: SidePoints,
): CheckResult {
  const stats = straightness(corners, target, edgePoints);
  const bad = stats.filter(
    (s) => s.angle > MAX_ANGLE_DEG || s.rms > MAX_LINE_RMS_PX,
  );
  const worst = stats.reduce((m, s) => Math.max(m, s.rms), 0);
  return {
    name: "straight-edges",
    pass: bad.length === 0,
    detail:
      bad.length === 0
        ? `warped edges are straight (worst residual ${worst.toFixed(2)} px)`
        : `warped edges are not straight: ${bad.map((s) => s.side).join(", ")}`,
  };
}

export function runChecks(input: CheckInput): CheckResult[] {
  return [
    checkCorners(input.corners, input.capture),
    checkConvex(input.corners),
    checkAspect(input.target, input.aspect),
    checkStraight(input.corners, input.target, input.edgePoints),
  ];
}

export function assertChecks(results: CheckResult[]): void {
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new CalibrationError(
      `Calibration check failed: ${failed.map((r) => r.detail).join("; ")}.`,
    );
  }
}

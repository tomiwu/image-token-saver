import {
  CalibrationError,
  SIDES,
  type Corners,
  type Point,
  type Side,
} from "./types.ts";

export interface Line {
  px: number;
  py: number;
  dx: number;
  dy: number;
}

export type SidePoints = Record<Side, Point[]>;

const MIN_POINTS = 8;
const TOLERANCES = [15, 8, 4, 2];

export function fitLine(points: Point[]): Line {
  const n = points.length;
  const mx = points.reduce((sum, p) => sum + p[0], 0) / n;
  const my = points.reduce((sum, p) => sum + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (y - my);
    syy += (y - my) * (y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}

export function distanceToLine(line: Line, point: Point): number {
  return Math.abs(
    (point[0] - line.px) * line.dy - (point[1] - line.py) * line.dx,
  );
}

export function rmsResidual(line: Line, points: Point[]): number {
  if (points.length === 0) {
    return 0;
  }
  const sum = points.reduce((acc, p) => acc + distanceToLine(line, p) ** 2, 0);
  return Math.sqrt(sum / points.length);
}

export function trimmedFit(points: Point[]): Line {
  let kept = points;
  let line = fitLine(kept);
  for (let pass = 0; pass < 2; pass++) {
    const limit = Math.max(1.5, 2.5 * rmsResidual(line, kept));
    const next = kept.filter((p) => distanceToLine(line, p) <= limit);
    if (next.length < MIN_POINTS) {
      break;
    }
    kept = next;
    line = fitLine(kept);
  }
  return line;
}

const RANSAC_DRAWS = 300;
const MIN_PAIR_SEPARATION = 15;
const INLIER_PX = 1.5;

function lineThrough(a: Point, b: Point): Line | undefined {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < MIN_PAIR_SEPARATION) {
    return undefined;
  }
  return {
    px: a[0],
    py: a[1],
    dx: (b[0] - a[0]) / length,
    dy: (b[1] - a[1]) / length,
  };
}

function countInliers(line: Line, points: Point[]): number {
  return points.filter((p) => distanceToLine(line, p) <= INLIER_PX).length;
}

function bestSampledLine(points: Point[]): Line | undefined {
  let seed = 12345;
  const draw = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * points.length);
  };
  let best: Line | undefined;
  let bestCount = -1;
  for (let i = 0; i < RANSAC_DRAWS; i++) {
    const line = lineThrough(points[draw()], points[draw()]);
    const count = line ? countInliers(line, points) : -1;
    if (line && count > bestCount) {
      best = line;
      bestCount = count;
    }
  }
  return best;
}

export function robustFit(points: Point[]): Line {
  const seedLine = bestSampledLine(points);
  if (!seedLine) {
    return trimmedFit(points);
  }
  const inliers = points.filter(
    (p) => distanceToLine(seedLine, p) <= 2 * INLIER_PX,
  );
  return inliers.length >= MIN_POINTS
    ? trimmedFit(inliers)
    : trimmedFit(points);
}

export function intersect(a: Line, b: Line): Point {
  const cross = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(cross) < 1e-9) {
    throw new CalibrationError("Two screen edges are parallel.");
  }
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / cross;
  return [a.px + t * a.dx, a.py + t * a.dy];
}

function emptySides(): SidePoints {
  return { top: [], right: [], bottom: [], left: [] };
}

function nearestSide(distances: Record<Side, number>): Side {
  return SIDES.reduce((best, side) =>
    distances[side] < distances[best] ? side : best,
  );
}

function assignByLabels(points: Point[], labels: Side[]): SidePoints {
  const sides = emptySides();
  points.forEach((p, i) => sides[labels[i]].push(p));
  return sides;
}

function assignToLines(
  points: Point[],
  lines: Record<Side, Line>,
  tolerance: number,
): SidePoints {
  const sides = emptySides();
  for (const p of points) {
    const distances = Object.fromEntries(
      SIDES.map((side) => [side, distanceToLine(lines[side], p)]),
    ) as Record<Side, number>;
    const side = nearestSide(distances);
    if (distances[side] <= tolerance) {
      sides[side].push(p);
    }
  }
  return sides;
}

function fitAll(sides: SidePoints): Record<Side, Line> {
  for (const side of SIDES) {
    if (sides[side].length < MIN_POINTS) {
      throw new CalibrationError(
        `The ${side} edge of the screen was not found.`,
      );
    }
  }
  return Object.fromEntries(
    SIDES.map((side) => [side, robustFit(sides[side])]),
  ) as Record<Side, Line>;
}

export function linesToCorners(lines: Record<Side, Line>): Corners {
  return {
    tl: intersect(lines.top, lines.left),
    tr: intersect(lines.top, lines.right),
    br: intersect(lines.bottom, lines.right),
    bl: intersect(lines.bottom, lines.left),
  };
}

export interface QuadFit {
  corners: Corners;
  sides: SidePoints;
  rms: number;
}

function inlierRms(lines: Record<Side, Line>, sides: SidePoints): number {
  let sum = 0;
  let count = 0;
  for (const side of SIDES) {
    for (const p of sides[side]) {
      sum += distanceToLine(lines[side], p) ** 2;
      count++;
    }
  }
  return Math.sqrt(sum / Math.max(count, 1));
}

export function fitQuad(points: Point[], labels: Side[]): QuadFit {
  let sides = assignByLabels(points, labels);
  let lines = fitAll(sides);
  for (const tolerance of TOLERANCES) {
    sides = assignToLines(points, lines, tolerance);
    lines = fitAll(sides);
  }
  return {
    corners: linesToCorners(lines),
    sides,
    rms: inlierRms(lines, sides),
  };
}

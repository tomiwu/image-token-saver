import {
  collectPeaks,
  computeGradients,
  magnitudeThreshold,
  windowMax,
  type EdgePeak,
  type Gradients,
  type PeakSet,
} from "./edges.ts";
import {
  distanceToLine,
  linesToCorners,
  rmsResidual,
  trimmedFit,
  type Line,
  type SidePoints,
} from "./line-fit.ts";
import type { GrayImage } from "./mask.ts";
import {
  CalibrationError,
  DEFAULT_ASPECT,
  SIDES,
  cornerList,
  type Corners,
  type Point,
  type Side,
  type Size,
} from "./types.ts";

export interface FittedLine extends Line {
  mid: Point;
  span: number;
  rms: number;
  support: number;
  inliers: EdgePeak[];
  kind: "v" | "h";
}

export interface ScoredQuad {
  corners: Corners;
  lines: Record<Side, FittedLine>;
  score: number;
  frac: number;
  aspect: number;
  aspectErr: number;
  rms: number;
  support: number;
}

const A_MIN = -0.45;
const A_MAX = 0.45;
const A_BINS = 91;
const C_STEP = 2;
const C_ORIGIN_PAD = 48;
const NMS_PAD = 2;
const MIN_INLIERS = 12;
const INLIER_PX = 2.8;
const MIN_SPAN_FRAC = 0.18;
const MIN_WIDTH_FRAC = 0.18;
const MIN_AREA_FRAC = 0.12;
const MAX_AREA_FRAC = 0.92;
const MAX_ASPECT_ERR = 0.5;
const MIN_SEGMENT_SUPPORT = 0.35;
const BORDER_FLUSH_PX = 8;
const LINE_UNIQUE_PX = 7;
const CLUSTER_DELTA = 0.05;
const MERGE_MIN_GAP = 6;
const MERGE_MAX_GAP = 24;
const HOUGH_KEEP = 20;
const SEGMENT_SAMPLES = 70;
const SEGMENT_BAND = 2;
const LIGHT_MIN = 110;
const DARK_MAX = 145;
const RIDGE_OFFSET = 7;
const RIDGE_GAP = 20;

interface Accumulator {
  acc: Float32Array;
  bins: number;
  length: number;
}

export function lineFromParams(
  kind: "v" | "h",
  slope: number,
  intercept: number,
  size: Size,
): Line {
  if (kind === "v") {
    const x0 = intercept + slope * (0 - size.height / 2);
    const x1 = intercept + slope * (size.height - 1 - size.height / 2);
    return unitLine(x0, 0, x1, size.height - 1);
  }
  const y0 = intercept + slope * (0 - size.width / 2);
  const y1 = intercept + slope * (size.width - 1 - size.width / 2);
  return unitLine(0, y0, size.width - 1, y1);
}

function unitLine(x0: number, y0: number, x1: number, y1: number): Line {
  const length = Math.hypot(x1 - x0, y1 - y0) || 1;
  return { px: x0, py: y0, dx: (x1 - x0) / length, dy: (y1 - y0) / length };
}

function slopeIndex(slope: number): number {
  return Math.round(((slope - A_MIN) / (A_MAX - A_MIN)) * (A_BINS - 1));
}

function interceptIndex(intercept: number): number {
  return Math.round((intercept + C_ORIGIN_PAD) / C_STEP);
}

function accIndex(acc: Accumulator, ia: number, ic: number): number {
  return ia * acc.length + ic;
}

function addVote(
  acc: Accumulator,
  ia: number,
  ic: number,
  weight: number,
): void {
  if (ia < 0 || ic < 0 || ia >= acc.bins || ic >= acc.length) {
    return;
  }
  acc.acc[accIndex(acc, ia, ic)] += weight;
}

function voteOne(
  acc: Accumulator,
  slope: number,
  intercept: number,
  mag: number,
): void {
  if (Math.abs(slope) > A_MAX) {
    return;
  }
  const ia = slopeIndex(slope);
  const ic = interceptIndex(intercept);
  for (let da = -1; da <= 1; da++) {
    voteColumn(acc, ia + da, ic, mag, da === 0);
  }
}

function voteColumn(
  acc: Accumulator,
  ia: number,
  ic: number,
  mag: number,
  center: boolean,
): void {
  for (let dc = -1; dc <= 1; dc++) {
    const weight = center && dc === 0 ? mag : mag * 0.5;
    addVote(acc, ia, ic + dc, weight);
  }
}

function verticalSlope(peak: EdgePeak): number | undefined {
  if (Math.abs(peak.gx) < 1e-3) {
    return undefined;
  }
  return -peak.gy / peak.gx;
}

function horizontalSlope(peak: EdgePeak): number | undefined {
  if (Math.abs(peak.gy) < 1e-3) {
    return undefined;
  }
  return -peak.gx / peak.gy;
}

function votePeaks(
  peaks: EdgePeak[],
  kind: "v" | "h",
  size: Size,
): Accumulator {
  const span = kind === "v" ? size.width : size.height;
  const length = Math.ceil((span + 2 * C_ORIGIN_PAD) / C_STEP) + 6;
  const acc: Accumulator = {
    acc: new Float32Array(A_BINS * length),
    bins: A_BINS,
    length,
  };
  const mid = kind === "v" ? size.height / 2 : size.width / 2;
  for (const peak of peaks) {
    votePeak(acc, peak, kind, mid);
  }
  return acc;
}

function votePeak(
  acc: Accumulator,
  peak: EdgePeak,
  kind: "v" | "h",
  mid: number,
): void {
  const slope = kind === "v" ? verticalSlope(peak) : horizontalSlope(peak);
  if (slope === undefined) {
    return;
  }
  const intercept =
    kind === "v"
      ? peak.x - slope * (peak.y - mid)
      : peak.y - slope * (peak.x - mid);
  voteOne(acc, slope, intercept, peak.mag);
}

interface AccPeak {
  score: number;
  slope: number;
  intercept: number;
}

function slopeAt(ia: number): number {
  return A_MIN + (ia / (A_BINS - 1)) * (A_MAX - A_MIN);
}

function isNmsMax(acc: Accumulator, ia: number, ic: number): boolean {
  const value = acc.acc[accIndex(acc, ia, ic)];
  if (value <= 0) {
    return false;
  }
  return value >= neighborhoodMax(acc, ia, ic);
}

function neighborhoodMax(acc: Accumulator, ia: number, ic: number): number {
  let max = 0;
  for (let da = -NMS_PAD; da <= NMS_PAD; da++) {
    max = Math.max(max, neighborhoodRowMax(acc, ia + da, ic));
  }
  return max;
}

function neighborhoodRowMax(acc: Accumulator, ia: number, ic: number): number {
  let max = 0;
  for (let dc = -NMS_PAD; dc <= NMS_PAD; dc++) {
    max = Math.max(max, acc.acc[accIndex(acc, ia, dc + ic)]);
  }
  return max;
}

function accumulatorPeaks(acc: Accumulator, keep: number): AccPeak[] {
  const found: AccPeak[] = [];
  for (let ia = NMS_PAD; ia < acc.bins - NMS_PAD; ia++) {
    collectAccRow(acc, ia, found);
  }
  found.sort((a, b) => b.score - a.score);
  return withExtrema(found, keep);
}

function collectAccRow(acc: Accumulator, ia: number, found: AccPeak[]): void {
  for (let ic = NMS_PAD; ic < acc.length - NMS_PAD; ic++) {
    if (isNmsMax(acc, ia, ic)) {
      found.push({
        score: acc.acc[accIndex(acc, ia, ic)],
        slope: slopeAt(ia),
        intercept: ic * C_STEP - C_ORIGIN_PAD,
      });
    }
  }
}

function similarAcc(a: AccPeak, b: AccPeak): boolean {
  return (
    Math.abs(a.slope - b.slope) < 0.04 &&
    Math.abs(a.intercept - b.intercept) < LINE_UNIQUE_PX
  );
}

function uniqueAccPeaks(peaks: AccPeak[]): AccPeak[] {
  const kept: AccPeak[] = [];
  for (const peak of peaks) {
    if (!kept.some((other) => similarAcc(peak, other))) {
      kept.push(peak);
    }
  }
  return kept;
}

function extremaOf(found: AccPeak[]): AccPeak[] {
  const floor = found[0].score * 0.05;
  const strong = found.filter((peak) => peak.score >= floor);
  const byIntercept = [...strong].sort((a, b) => a.intercept - b.intercept);
  return [...byIntercept.slice(0, 8), ...byIntercept.slice(-8)];
}

function withExtrema(found: AccPeak[], keep: number): AccPeak[] {
  if (found.length === 0) {
    return found;
  }
  return uniqueAccPeaks([...found.slice(0, keep), ...extremaOf(found)]);
}

function peakPoint(peak: EdgePeak): Point {
  return [peak.x, peak.y];
}

function fitFromPeaks(peaks: EdgePeak[]): Line {
  return trimmedFit(peaks.map(peakPoint));
}

function nearLine(line: Line, peak: EdgePeak, tol: number): boolean {
  return distanceToLine(line, peakPoint(peak)) <= tol;
}

function spanOf(kind: "v" | "h", peaks: EdgePeak[]): number {
  const values = peaks.map((p) => (kind === "v" ? p.y : p.x));
  return Math.max(...values) - Math.min(...values);
}

function midOf(kind: "v" | "h", peaks: EdgePeak[]): Point {
  const xs = peaks.map((p) => p.x);
  const ys = peaks.map((p) => p.y);
  if (kind === "v") {
    return [mean(xs), (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return [(Math.min(...xs) + Math.max(...xs)) / 2, mean(ys)];
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function refineLine(
  seed: Line,
  kind: "v" | "h",
  peaks: EdgePeak[],
): FittedLine | undefined {
  const close = peaks.filter((p) => nearLine(seed, p, INLIER_PX));
  if (close.length < MIN_INLIERS) {
    return undefined;
  }
  const line = fitFromPeaks(close);
  const kept = tighten(line, close);
  return toFitted(line, kind, kept.length >= MIN_INLIERS ? kept : close);
}

function tighten(line: Line, peaks: EdgePeak[]): EdgePeak[] {
  const limit = Math.max(1.5, 2.5 * rmsResidual(line, peaks.map(peakPoint)));
  const next = peaks.filter((p) => nearLine(line, p, limit));
  return next.length >= MIN_INLIERS ? next : peaks;
}

function toFitted(seed: Line, kind: "v" | "h", peaks: EdgePeak[]): FittedLine {
  const line = fitFromPeaks(peaks);
  return {
    ...line,
    kind,
    inliers: peaks,
    rms: rmsResidual(line, peaks.map(peakPoint)),
    support: peaks.reduce((sum, p) => sum + p.mag, 0),
    span: spanOf(kind, peaks),
    mid: midOf(kind, peaks),
  };
}

export function uniqueLines(
  lines: FittedLine[],
  minSep = LINE_UNIQUE_PX,
): FittedLine[] {
  const kept: FittedLine[] = [];
  for (const line of [...lines].sort((a, b) => b.support - a.support)) {
    if (!kept.some((other) => tooClose(line, other, minSep))) {
      kept.push(line);
    }
  }
  return kept;
}

function tooClose(a: FittedLine, b: FittedLine, minSep: number): boolean {
  return Math.hypot(a.mid[0] - b.mid[0], a.mid[1] - b.mid[1]) < minSep;
}

function minSpan(kind: "v" | "h", size: Size): number {
  return (kind === "v" ? size.height : size.width) * MIN_SPAN_FRAC;
}

function linesFromVotes(
  peaks: EdgePeak[],
  kind: "v" | "h",
  size: Size,
  keep: number,
): FittedLine[] {
  const raw = accumulatorPeaks(votePeaks(peaks, kind, size), keep);
  const fitted = raw
    .map((peak) =>
      refineLine(
        lineFromParams(kind, peak.slope, peak.intercept, size),
        kind,
        peaks,
      ),
    )
    .filter((line): line is FittedLine => line !== undefined)
    .filter((line) => line.span >= minSpan(kind, size));
  return uniqueLines(fitted);
}

function peaksInBand(
  peaks: EdgePeak[],
  axis: "x" | "y",
  lo: number,
  hi: number,
): EdgePeak[] {
  return peaks.filter((peak) => {
    const value = axis === "x" ? peak.x : peak.y;
    return value >= lo && value < hi;
  });
}

function sideBands(
  peaks: EdgePeak[],
  kind: "v" | "h",
  size: Size,
): EdgePeak[][] {
  if (kind === "v") {
    return [
      peaksInBand(peaks, "x", 0, size.width * 0.45),
      peaksInBand(peaks, "x", size.width * 0.55, size.width),
    ];
  }
  return [
    peaksInBand(peaks, "y", 0, size.height * 0.45),
    peaksInBand(peaks, "y", size.height * 0.55, size.height),
  ];
}

function nearAny(lines: FittedLine[], peak: EdgePeak, tol: number): boolean {
  return lines.some((line) => nearLine(line, peak, tol));
}

function iterativeLines(
  peaks: EdgePeak[],
  kind: "v" | "h",
  size: Size,
  rounds: number,
  keep: number,
): FittedLine[] {
  const found: FittedLine[] = [];
  let remaining = peaks;
  for (let round = 0; round < rounds; round++) {
    const next = linesFromVotes(remaining, kind, size, keep);
    if (next.length === 0) {
      break;
    }
    found.push(...next);
    remaining = remaining.filter((peak) => !nearAny(next, peak, 3));
  }
  return uniqueLines(found);
}

function extractLines(
  peaks: EdgePeak[],
  kind: "v" | "h",
  size: Size,
): FittedLine[] {
  const global = iterativeLines(peaks, kind, size, 2, HOUGH_KEEP);
  const extra = sideBands(peaks, kind, size).flatMap((band) =>
    iterativeLines(band, kind, size, 3, 20),
  );
  return uniqueLines(global.concat(extra));
}

export function polygonArea(corners: Corners): number {
  const points = cornerList(corners);
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(sum) / 2;
}

function crossAt(points: Point[], i: number): number {
  const a = points[i];
  const b = points[(i + 1) % points.length];
  const c = points[(i + 2) % points.length];
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}

export function isConvex(corners: Corners): boolean {
  const points = cornerList(corners);
  const signs = points.map((_, i) => Math.sign(crossAt(points, i)));
  return signs.every((s) => s !== 0 && s === signs[0]);
}

export function midSideAspect(corners: Corners): number {
  const [tl, tr, br, bl] = cornerList(corners);
  const width =
    (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) +
      Math.hypot(br[0] - bl[0], br[1] - bl[1])) /
    2;
  const height =
    (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) +
      Math.hypot(br[0] - tr[0], br[1] - tr[1])) /
    2;
  return width / Math.max(height, 1e-6);
}

function flushLow(a: number, b: number, margin: number): boolean {
  return a <= margin && b <= margin;
}

function flushHigh(a: number, b: number, limit: number): boolean {
  return a >= limit && b >= limit;
}

function onSameBorder(p: Point, q: Point, size: Size, margin: number): boolean {
  return (
    flushLow(p[1], q[1], margin) ||
    flushHigh(p[1], q[1], size.height - 1 - margin) ||
    flushLow(p[0], q[0], margin) ||
    flushHigh(p[0], q[0], size.width - 1 - margin)
  );
}

export function flushSide(
  corners: Corners,
  size: Size,
  margin = BORDER_FLUSH_PX,
): boolean {
  const [tl, tr, br, bl] = cornerList(corners);
  return (
    onSameBorder(tl, tr, size, margin) ||
    onSameBorder(tr, br, size, margin) ||
    onSameBorder(br, bl, size, margin) ||
    onSameBorder(bl, tl, size, margin)
  );
}

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

function sidePairs(corners: Corners): [Point, Point][] {
  const [tl, tr, br, bl] = cornerList(corners);
  return [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ];
}

function segmentHits(
  a: Point,
  b: Point,
  gradients: Gradients,
  size: Size,
  thresh: number,
): number {
  let hit = 0;
  let usable = 0;
  for (let i = 0; i < SEGMENT_SAMPLES; i++) {
    const [x, y] = lerp(a, b, (i + 0.5) / SEGMENT_SAMPLES);
    const xi = Math.round(x);
    const yi = Math.round(y);
    usable += inside(xi, yi, size);
    hit += sampleHit(gradients, size, xi, yi, thresh);
  }
  return hit / Math.max(usable, 1);
}

function inside(x: number, y: number, size: Size): number {
  return x >= 0 && y >= 0 && x < size.width && y < size.height ? 1 : 0;
}

function sampleHit(
  gradients: Gradients,
  size: Size,
  x: number,
  y: number,
  thresh: number,
): number {
  if (!inside(x, y, size)) {
    return 0;
  }
  return windowMax(gradients, size.width, size.height, x, y, SEGMENT_BAND) >=
    thresh
    ? 1
    : 0;
}

export function segmentSupport(
  corners: Corners,
  gradients: Gradients,
  size: Size,
  thresh: number,
): number {
  const scores = sidePairs(corners).map(([a, b]) =>
    segmentHits(a, b, gradients, size, thresh),
  );
  return mean(scores);
}

function tryCorners(lines: Record<Side, FittedLine>): Corners | undefined {
  try {
    return linesToCorners(lines);
  } catch {
    return undefined;
  }
}

function aspectErr(aspect: number, target: number): number {
  return Math.abs(Math.log(Math.max(aspect, 1e-6) / target));
}

function sideCoverage(line: FittedLine, a: Point, b: Point): number {
  const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
  return Math.min(1, line.span / Math.max(length, 1));
}

function spanCoverage(
  lines: Record<Side, FittedLine>,
  corners: Corners,
): number {
  const [tl, tr, br, bl] = cornerList(corners);
  return mean([
    sideCoverage(lines.top, tl, tr),
    sideCoverage(lines.right, tr, br),
    sideCoverage(lines.bottom, br, bl),
    sideCoverage(lines.left, bl, tl),
  ]);
}

function scoreQuad(
  frac: number,
  support: number,
  aspectE: number,
  rms: number,
  coverage: number,
): number {
  return 2.2 * frac + 2.4 * support - 0.6 * aspectE - 1.2 * rms + coverage;
}

function meanRms(lines: Record<Side, FittedLine>): number {
  return mean(SIDES.map((side) => lines[side].rms));
}

function areaOutOfRange(frac: number): boolean {
  return frac < MIN_AREA_FRAC || frac > MAX_AREA_FRAC;
}

function geometryStats(
  corners: Corners,
  size: Size,
  targetAspect: number,
): { frac: number; aspect: number; err: number } | undefined {
  if (!isConvex(corners) || flushSide(corners, size)) {
    return undefined;
  }
  const frac = polygonArea(corners) / (size.width * size.height);
  const aspect = midSideAspect(corners);
  const err = aspectErr(aspect, targetAspect);
  if (areaOutOfRange(frac) || err > MAX_ASPECT_ERR) {
    return undefined;
  }
  return { frac, aspect, err };
}

function evaluateQuad(
  lines: Record<Side, FittedLine>,
  size: Size,
  targetAspect: number,
  gradients: Gradients,
  thresh: number,
): ScoredQuad | undefined {
  const corners = tryCorners(lines);
  if (!corners) {
    return undefined;
  }
  const stats = geometryStats(corners, size, targetAspect);
  if (!stats) {
    return undefined;
  }
  const support = segmentSupport(corners, gradients, size, thresh);
  if (support < MIN_SEGMENT_SUPPORT) {
    return undefined;
  }
  return {
    corners,
    lines,
    score: scoreQuad(
      stats.frac,
      support,
      stats.err,
      meanRms(lines),
      spanCoverage(lines, corners),
    ),
    frac: stats.frac,
    aspect: stats.aspect,
    aspectErr: stats.err,
    rms: meanRms(lines),
    support,
  };
}

function enumerateQuads(
  vertical: FittedLine[],
  horizontal: FittedLine[],
  size: Size,
  targetAspect: number,
  gradients: Gradients,
  thresh: number,
): ScoredQuad[] {
  const scored: ScoredQuad[] = [];
  for (const left of vertical) {
    collectWithLeft(
      left,
      vertical,
      horizontal,
      size,
      targetAspect,
      gradients,
      thresh,
      scored,
    );
  }
  return scored.sort((a, b) => b.score - a.score);
}

function collectWithLeft(
  left: FittedLine,
  vertical: FittedLine[],
  horizontal: FittedLine[],
  size: Size,
  targetAspect: number,
  gradients: Gradients,
  thresh: number,
  scored: ScoredQuad[],
): void {
  for (const right of vertical) {
    if (right.mid[0] - left.mid[0] >= MIN_WIDTH_FRAC * size.width) {
      collectWithPair(
        left,
        right,
        horizontal,
        size,
        targetAspect,
        gradients,
        thresh,
        scored,
      );
    }
  }
}

function collectWithPair(
  left: FittedLine,
  right: FittedLine,
  horizontal: FittedLine[],
  size: Size,
  targetAspect: number,
  gradients: Gradients,
  thresh: number,
  scored: ScoredQuad[],
): void {
  for (const top of horizontal) {
    collectBottoms(
      left,
      right,
      top,
      horizontal,
      size,
      targetAspect,
      gradients,
      thresh,
      scored,
    );
  }
}

function collectBottoms(
  left: FittedLine,
  right: FittedLine,
  top: FittedLine,
  horizontal: FittedLine[],
  size: Size,
  targetAspect: number,
  gradients: Gradients,
  thresh: number,
  scored: ScoredQuad[],
): void {
  for (const bottom of horizontal) {
    if (bottom.mid[1] - top.mid[1] < MIN_WIDTH_FRAC * size.height) {
      continue;
    }
    const quad = evaluateQuad(
      { top, right, bottom, left },
      size,
      targetAspect,
      gradients,
      thresh,
    );
    if (quad) {
      scored.push(quad);
    }
  }
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function clusterNearBest(
  scored: ScoredQuad[],
  delta = CLUSTER_DELTA,
): ScoredQuad[] {
  const best = scored[0].score;
  return scored.filter((item) => item.score >= best - delta);
}

function closerToMedian(
  item: ScoredQuad,
  best: ScoredQuad,
  target: number,
): boolean {
  const delta = Math.abs(item.frac - target) - Math.abs(best.frac - target);
  if (delta !== 0) {
    return delta < 0;
  }
  return item.score > best.score;
}

function hasOuterBezel(
  image: GrayImage,
  line: FittedLine,
  others: FittedLine[],
  side: Side,
): boolean {
  return others.some((other) => isBezelInner(image, other, line, side));
}

function bezelCount(
  image: GrayImage,
  lines: Record<Side, FittedLine>,
  vertical: FittedLine[],
  horizontal: FittedLine[],
): number {
  return (
    Number(hasOuterBezel(image, lines.left, vertical, "left")) +
    Number(hasOuterBezel(image, lines.right, vertical, "right")) +
    Number(hasOuterBezel(image, lines.top, horizontal, "top")) +
    Number(hasOuterBezel(image, lines.bottom, horizontal, "bottom"))
  );
}

function withBezelBonus(
  image: GrayImage,
  scored: ScoredQuad[],
  vertical: FittedLine[],
  horizontal: FittedLine[],
): ScoredQuad[] {
  return scored
    .map((item) => ({
      ...item,
      score:
        item.score + 0.12 * bezelCount(image, item.lines, vertical, horizontal),
    }))
    .sort((a, b) => b.score - a.score);
}

export function pickConsensus(scored: ScoredQuad[]): ScoredQuad {
  const cluster = clusterNearBest(scored);
  const target = median(cluster.map((item) => item.frac));
  return cluster.reduce((best, item) =>
    closerToMedian(item, best, target) ? item : best,
  );
}

function parallel(a: FittedLine, b: FittedLine): boolean {
  return Math.abs(a.dx * b.dx + a.dy * b.dy) > 0.95;
}

function lineGap(a: FittedLine, b: FittedLine): number {
  return distanceToLine(a, b.mid);
}

const MIN_REGION_SPLIT = 15;
const BEZEL_VAR_MAX = 150;
const STRIP_SAMPLES = 40;

function shiftedPoint(line: FittedLine, t: number, offset: number): Point {
  return [
    line.mid[0] + (t - 0.5) * line.dx * line.span - line.dy * offset,
    line.mid[1] + (t - 0.5) * line.dy * line.span + line.dx * offset,
  ];
}

function collectBandSamples(
  image: GrayImage,
  line: FittedLine,
  sign: number,
  values: number[],
): void {
  for (const offset of [8, 12, 16, 20, 24, 28]) {
    collectOffsetSamples(image, line, sign * offset, values);
  }
}

function collectOffsetSamples(
  image: GrayImage,
  line: FittedLine,
  offset: number,
  values: number[],
): void {
  for (let i = 0; i < STRIP_SAMPLES; i++) {
    const value = sampleGray(
      image,
      shiftedPoint(line, (i + 0.5) / STRIP_SAMPLES, offset),
    );
    if (value !== undefined) {
      values.push(value);
    }
  }
}

function bandMedian(image: GrayImage, line: FittedLine, sign: number): number {
  const values: number[] = [];
  collectBandSamples(image, line, sign, values);
  return values.length === 0 ? 0 : median(values);
}

function regionSplit(image: GrayImage, line: FittedLine): number {
  return Math.abs(bandMedian(image, line, 1) - bandMedian(image, line, -1));
}

function lineMedian(image: GrayImage, line: FittedLine): number {
  const values: number[] = [];
  collectOffsetSamples(image, line, 0, values);
  return values.length === 0 ? 0 : median(values);
}

function isDarkRidge(image: GrayImage, line: FittedLine): boolean {
  const on = lineMedian(image, line);
  const darker = Math.min(
    bandMedian(image, line, 1),
    bandMedian(image, line, -1),
  );
  return on + RIDGE_GAP < darker;
}

function keepRegionLine(image: GrayImage, line: FittedLine): boolean {
  return (
    regionSplit(image, line) >= MIN_REGION_SPLIT && !isDarkRidge(image, line)
  );
}

function filterRegionLines(
  image: GrayImage,
  lines: FittedLine[],
): FittedLine[] {
  return lines.filter((line) => keepRegionLine(image, line));
}

function ridgeSides(
  image: GrayImage,
  peak: EdgePeak,
): [number, number] | undefined {
  const mag = Math.hypot(peak.gx, peak.gy) || 1;
  const nx = (RIDGE_OFFSET * peak.gx) / mag;
  const ny = (RIDGE_OFFSET * peak.gy) / mag;
  const a = sampleGray(image, [peak.x + nx, peak.y + ny]);
  const b = sampleGray(image, [peak.x - nx, peak.y - ny]);
  if (a === undefined || b === undefined) {
    return undefined;
  }
  return [a, b];
}

function peakIsRidge(image: GrayImage, peak: EdgePeak): boolean {
  const on = sampleGray(image, [peak.x, peak.y]);
  const sides = ridgeSides(image, peak);
  if (on === undefined || sides === undefined) {
    return false;
  }
  return on + RIDGE_GAP < Math.min(sides[0], sides[1]);
}

function stepPeaks(image: GrayImage, peaks: EdgePeak[]): EdgePeak[] {
  return peaks.filter((peak) => !peakIsRidge(image, peak));
}

function varianceOf(values: number[]): number {
  if (values.length === 0) {
    return Infinity;
  }
  const avg = mean(values);
  return mean(values.map((value) => (value - avg) ** 2));
}

function signedGap(from: FittedLine, toward: FittedLine): number {
  const nx = -from.dy;
  const ny = from.dx;
  return (
    (toward.mid[0] - from.mid[0]) * nx + (toward.mid[1] - from.mid[1]) * ny
  );
}

function stripVariance(
  image: GrayImage,
  outer: FittedLine,
  inner: FittedLine,
): number {
  const offset = signedGap(outer, inner) / 2;
  const values: number[] = [];
  for (let i = 0; i < STRIP_SAMPLES; i++) {
    const value = sampleGray(
      image,
      shiftedPoint(outer, (i + 0.5) / STRIP_SAMPLES, offset),
    );
    if (value !== undefined) {
      values.push(value);
    }
  }
  return varianceOf(values);
}

function uniformBezel(
  image: GrayImage,
  outer: FittedLine,
  inner: FittedLine,
): boolean {
  return stripVariance(image, outer, inner) <= BEZEL_VAR_MAX;
}

function similarLine(a: FittedLine, b: FittedLine): boolean {
  return a !== b && a.kind === b.kind && parallel(a, b);
}

function inBezelGap(gap: number): boolean {
  return gap >= MERGE_MIN_GAP && gap <= MERGE_MAX_GAP;
}

function strongEnough(inner: FittedLine, outer: FittedLine): boolean {
  return inner.span >= 0.6 * outer.span && inner.support >= 0.7 * outer.support;
}

function inwardDelta(side: Side, from: FittedLine, other: FittedLine): number {
  if (side === "left") {
    return other.mid[0] - from.mid[0];
  }
  if (side === "right") {
    return from.mid[0] - other.mid[0];
  }
  if (side === "top") {
    return other.mid[1] - from.mid[1];
  }
  return from.mid[1] - other.mid[1];
}

function isCloseInner(
  chosen: FittedLine,
  other: FittedLine,
  side: Side,
): boolean {
  return (
    similarLine(chosen, other) &&
    inBezelGap(lineGap(chosen, other)) &&
    inwardDelta(side, chosen, other) >= MERGE_MIN_GAP &&
    strongEnough(other, chosen)
  );
}

function isBezelInner(
  image: GrayImage,
  chosen: FittedLine,
  other: FittedLine,
  side: Side,
): boolean {
  return (
    isCloseInner(chosen, other, side) && uniformBezel(image, chosen, other)
  );
}

function peaksNear(
  line: FittedLine,
  peaks: EdgePeak[],
  tol: number,
): EdgePeak[] {
  return peaks.filter((peak) => nearLine(line, peak, tol));
}

export function sidePointsFromLines(
  lines: Record<Side, FittedLine>,
): SidePoints {
  return Object.fromEntries(
    SIDES.map((side) => [side, lines[side].inliers.map(peakPoint)]),
  ) as SidePoints;
}

export function wideSidePoints(
  lines: Record<Side, FittedLine>,
  peaks: PeakSet,
  tol = 10,
): SidePoints {
  return {
    top: peaksNear(lines.top, peaks.horizontal, tol).map(peakPoint),
    right: peaksNear(lines.right, peaks.vertical, tol).map(peakPoint),
    bottom: peaksNear(lines.bottom, peaks.horizontal, tol).map(peakPoint),
    left: peaksNear(lines.left, peaks.vertical, tol).map(peakPoint),
  };
}

export interface HairlineHit {
  corners: Corners;
  lines: Record<Side, FittedLine>;
  edgePoints: SidePoints;
  loosePoints: SidePoints;
  rms: number;
  frac: number;
}

export function detectHairlines(
  image: GrayImage,
  aspect = DEFAULT_ASPECT,
): HairlineHit | undefined {
  const gradients = computeGradients(image);
  const thresh = magnitudeThreshold(gradients.mag);
  const peaks = collectPeaks(image, gradients, thresh);
  const stepped = {
    vertical: stepPeaks(image, peaks.vertical),
    horizontal: stepPeaks(image, peaks.horizontal),
  };
  const rawVertical = extractLines(stepped.vertical, "v", image);
  const rawHorizontal = extractLines(stepped.horizontal, "h", image);
  const vertical = filterRegionLines(image, rawVertical);
  const horizontal = filterRegionLines(image, rawHorizontal);
  const scored = enumerateQuads(
    vertical,
    horizontal,
    image,
    aspect,
    gradients,
    thresh,
  );
  if (scored.length === 0) {
    return undefined;
  }
  const chosen = pickConsensus(
    withBezelBonus(image, scored, vertical, horizontal),
  );
  const lines = chosen.lines;
  const corners = tryCorners(lines) ?? chosen.corners;
  return {
    corners,
    lines,
    edgePoints: sidePointsFromLines(lines),
    loosePoints: wideSidePoints(lines, peaks),
    rms: meanRms(lines),
    frac: polygonArea(corners) / (image.width * image.height),
  };
}

function bilinear(corners: Corners, u: number, v: number): Point {
  const top = lerp(corners.tl, corners.tr, u);
  const bottom = lerp(corners.bl, corners.br, u);
  return lerp(top, bottom, v);
}

function sampleGray(image: GrayImage, point: Point): number | undefined {
  const x = Math.round(point[0]);
  const y = Math.round(point[1]);
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return undefined;
  }
  return image.data[y * image.width + x];
}

export function interiorMean(image: GrayImage, corners: Corners): number {
  const values: number[] = [];
  for (let i = 0; i < 10; i++) {
    collectInteriorRow(image, corners, (i + 0.5) / 10, values);
  }
  return values.length === 0 ? 0 : mean(values);
}

function collectInteriorRow(
  image: GrayImage,
  corners: Corners,
  v: number,
  values: number[],
): void {
  for (let j = 0; j < 10; j++) {
    const value = sampleGray(
      image,
      bilinear(corners, (j + 0.5) / 10, 0.15 + 0.7 * v),
    );
    if (value !== undefined) {
      values.push(value);
    }
  }
}

export function polarityOk(
  panel: "auto" | "light" | "dark",
  mean: number,
): boolean {
  if (panel === "light") {
    return mean >= LIGHT_MIN;
  }
  if (panel === "dark") {
    return mean <= DARK_MAX;
  }
  return true;
}

export function hairlineError(): CalibrationError {
  return new CalibrationError(
    "The screen was not found in the frame. Check the camera view and the lighting. Part of the panel may be outside the frame.",
  );
}

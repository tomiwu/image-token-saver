import { applyEdgeOffsets, type EdgeOffsets } from "./edge-offsets.ts";
import { runChecks } from "./checks.ts";
import type { SidePoints } from "./line-fit.ts";
import { allStripsClean, edgeStripReport } from "./strip-check.ts";
import {
  SIDES,
  VIEW_WIDTH,
  viewSize,
  type Corners,
  type Side,
  type Size,
} from "./types.ts";
import { encodePng, warpRaw, type RawImage } from "./warp.ts";

export const MAX_LLM_CALLS = 2;
export const MAX_LLM_OFFSET_VIEW_PX = 60;

export interface SideVerdict {
  nonUiVisible: boolean;
  uiCutOff: boolean;
  offsetPx: number;
}

export interface LlmVerdict {
  sides: Record<Side, SideVerdict>;
  tokens?: number;
}

export interface LlmRequest {
  front: Buffer;
  overlay: Buffer;
  frontWidth: number;
  round: number;
}

export interface LlmRefiner {
  review(request: LlmRequest): Promise<LlmVerdict>;
}

export interface LlmRound {
  round: number;
  verdict: LlmVerdict;
  offsets: EdgeOffsets;
  corners: Corners;
  applied: boolean;
  note: string;
  tokens?: number;
}

export interface RefineContext {
  source: RawImage;
  corners: Corners;
  k1: number;
  capture: Size;
  target: Size;
  aspect: number;
  edgePoints: SidePoints;
  width: number;
  overlay: (corners: Corners) => Promise<Buffer>;
}

export interface RefineResult {
  corners: Corners;
  rounds: LlmRound[];
  totalTokens?: number;
}

interface Step {
  corners: Corners;
  stop: boolean;
  round: LlmRound;
}

function clampViewOffsetPx(value: number): number {
  return Math.max(
    -MAX_LLM_OFFSET_VIEW_PX,
    Math.min(MAX_LLM_OFFSET_VIEW_PX, value),
  );
}

export function verdictOffsets(
  verdict: LlmVerdict,
  factor: number,
): EdgeOffsets {
  const offsets: EdgeOffsets = {};
  for (const side of SIDES) {
    const entry = verdict.sides[side];
    const unclean = entry.nonUiVisible || entry.uiCutOff;
    if (unclean && entry.offsetPx !== 0) {
      offsets[side] = clampViewOffsetPx(entry.offsetPx * factor);
    }
  }
  return offsets;
}

function stepFor(
  base: Omit<LlmRound, "applied" | "note" | "offsets" | "corners">,
  corners: Corners,
  fields: Pick<LlmRound, "applied" | "note" | "offsets">,
  stop: boolean,
): Step {
  return { corners, stop, round: { ...base, ...fields, corners } };
}

function geometryFor(ctx: RefineContext, corners: Corners) {
  return { corners, k1: ctx.k1, capture: ctx.capture };
}

function candidateFor(
  ctx: RefineContext,
  corners: Corners,
  offsets: EdgeOffsets,
): { corners?: Corners; failure?: string } {
  const next = applyEdgeOffsets(corners, ctx.target, offsets);
  const failed = runChecks({ ...ctx, corners: next }).filter((r) => !r.pass);
  return failed.length === 0
    ? { corners: next }
    : { failure: failed.map((r) => r.detail).join("; ") };
}

async function oneRound(
  refiner: LlmRefiner,
  ctx: RefineContext,
  corners: Corners,
  round: number,
): Promise<Step> {
  const size = viewSize(ctx.target, ctx.width);
  const front = warpRaw(ctx.source, geometryFor(ctx, corners), size);
  const verdict = await refiner.review({
    front: await encodePng(front),
    overlay: await ctx.overlay(corners),
    frontWidth: size.width,
    round,
  });
  const base = { round, verdict, tokens: verdict.tokens };
  const offsets = verdictOffsets(verdict, VIEW_WIDTH / size.width);
  if (Object.keys(offsets).length === 0) {
    return stepFor(
      base,
      corners,
      { applied: false, note: "no change asked", offsets },
      true,
    );
  }
  const candidate = candidateFor(ctx, corners, offsets);
  if (!candidate.corners) {
    const note = `reverted: ${candidate.failure}`;
    return stepFor(base, corners, { applied: false, note, offsets }, true);
  }
  const after = warpRaw(ctx.source, geometryFor(ctx, candidate.corners), size);
  const clean = allStripsClean(edgeStripReport(after));
  const note = clean ? "edge strips clean" : "edge strips not clean";
  return stepFor(
    base,
    candidate.corners,
    { applied: true, note, offsets },
    clean,
  );
}

function sumTokens(rounds: LlmRound[]): number | undefined {
  const measured = rounds.filter((r) => r.tokens !== undefined);
  if (measured.length === 0) {
    return undefined;
  }
  return measured.reduce((sum, r) => sum + (r.tokens ?? 0), 0);
}

export async function refineWithLlm(
  refiner: LlmRefiner,
  ctx: RefineContext,
): Promise<RefineResult> {
  let corners = ctx.corners;
  const rounds: LlmRound[] = [];
  for (let n = 1; n <= MAX_LLM_CALLS; n++) {
    const step = await oneRound(refiner, ctx, corners, n);
    rounds.push(step.round);
    corners = step.corners;
    if (step.stop) {
      break;
    }
  }
  return { corners, rounds, totalTokens: sumTokens(rounds) };
}

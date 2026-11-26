import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  pendingPath,
  phoneCheckPath,
  writeJson,
  type Draft,
} from "./calibration-file.ts";
import { assertChecks, runChecks } from "./checks.ts";
import { detectPanel, type Panel } from "./detect.ts";
import { refineWithLlm, type LlmRefiner } from "./llm-refine.ts";
import { loadGray } from "./mask.ts";
import { INSTRUCTION, renderOverlay, writePhoneCheck } from "./phone-check.ts";
import {
  DEFAULT_ASPECT,
  DEFAULT_TARGET,
  DEFAULT_WARP_WIDTH,
  VIEW_WIDTH,
  type Corners,
  type Size,
} from "./types.ts";
import { decodeRgb } from "./warp.ts";

export interface CalibrateOptions {
  image: string;
  out: string;
  target?: Size;
  aspect?: number;
  panel?: Panel;
  llm?: LlmRefiner;
  llmWidth?: number;
  now?: () => Date;
}

export function nextSteps(out: string): string[] {
  return [
    `phone-check=${phoneCheckPath(out)}`,
    `draft=${pendingPath(out)}`,
    INSTRUCTION,
    "Apply the reply with: image-token-saver calibrate adjust ok",
    "Or with offsets: image-token-saver calibrate adjust right -10",
  ];
}

async function refine(
  options: CalibrateOptions,
  bytes: Uint8Array,
  draft: Draft,
): Promise<{ corners: Corners; llm?: Draft["llm_refine"] }> {
  if (!options.llm) {
    return { corners: draft.corners };
  }
  const result = await refineWithLlm(options.llm, {
    source: await decodeRgb(bytes),
    corners: draft.corners,
    k1: draft.k1,
    capture: draft.capture,
    target: draft.target,
    aspect: draft.aspect,
    edgePoints: draft.edgePoints,
    width: options.llmWidth ?? DEFAULT_WARP_WIDTH,
    overlay: (corners) =>
      renderOverlay(
        bytes,
        { corners, k1: draft.k1, capture: draft.capture },
        VIEW_WIDTH,
      ),
  });
  return {
    corners: result.corners,
    llm: { rounds: result.rounds, totalTokens: result.totalTokens },
  };
}

export async function calibrate(options: CalibrateOptions): Promise<string> {
  const bytes = await readFile(options.image);
  const gray = await loadGray(bytes);
  const found = detectPanel(gray, options.panel ?? "auto");
  const draft: Draft = {
    version: 1,
    capture: { width: gray.width, height: gray.height },
    corners: found.corners,
    k1: found.k1,
    target: options.target ?? DEFAULT_TARGET,
    created: (options.now?.() ?? new Date()).toISOString(),
    checks: [],
    adjustments: [],
    aspect: options.aspect ?? DEFAULT_ASPECT,
    source: resolve(options.image),
    edgePoints: found.edgePoints,
  };
  assertChecks(runChecks(draft));
  const refined = await refine(options, bytes, draft);
  draft.corners = refined.corners;
  draft.llm_refine = refined.llm;
  draft.checks = runChecks(draft);
  assertChecks(draft.checks);
  await writeJson(pendingPath(options.out), draft);
  await writePhoneCheck(
    bytes,
    { corners: draft.corners, k1: draft.k1, capture: draft.capture },
    draft.target,
    phoneCheckPath(options.out),
  );
  return nextSteps(options.out).join("\n");
}

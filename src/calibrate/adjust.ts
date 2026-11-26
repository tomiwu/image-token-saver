import { readFile, rm } from "node:fs/promises";
import {
  parseCalibration,
  pendingPath,
  phoneCheckPath,
  writeJson,
  type Calibration,
  type Draft,
} from "./calibration-file.ts";
import { assertChecks, runChecks } from "./checks.ts";
import { applyEdgeOffsets, parseOffsets } from "./edge-offsets.ts";
import { writePhoneCheck } from "./phone-check.ts";
import { CalibrationError } from "./types.ts";

export interface AdjustOptions {
  cal: string;
  words: string[];
  now?: () => Date;
}

async function readDraft(calPath: string): Promise<Draft> {
  const path = pendingPath(calPath);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new CalibrationError(
      `No draft found at "${path}". Run calibrate first.`,
    );
  }
  return parseCalibration(text, path) as Draft;
}

export function finalize(draft: Draft, now: Date): Calibration {
  const final: Calibration = {
    version: 1,
    capture: draft.capture,
    corners: draft.corners,
    k1: draft.k1,
    target: draft.target,
    created: now.toISOString(),
    checks: draft.checks,
    adjustments: draft.adjustments,
  };
  return draft.llm_refine ? { ...final, llm_refine: draft.llm_refine } : final;
}

async function confirm(options: AdjustOptions, draft: Draft): Promise<string> {
  draft.checks = runChecks(draft);
  assertChecks(draft.checks);
  await writeJson(options.cal, finalize(draft, options.now?.() ?? new Date()));
  await rm(pendingPath(options.cal), { force: true });
  return `calibration=${options.cal}`;
}

async function move(options: AdjustOptions, draft: Draft): Promise<string> {
  const offsets = parseOffsets(options.words);
  draft.corners = applyEdgeOffsets(draft.corners, draft.target, offsets);
  draft.adjustments = [...draft.adjustments, offsets];
  draft.checks = runChecks(draft);
  assertChecks(draft.checks);
  await writeJson(pendingPath(options.cal), draft);
  await writePhoneCheck(
    await readFile(draft.source),
    { corners: draft.corners, k1: draft.k1, capture: draft.capture },
    draft.target,
    phoneCheckPath(options.cal),
  );
  await writeJson(options.cal, finalize(draft, options.now?.() ?? new Date()));
  return [
    `calibration=${options.cal}`,
    `phone-check=${phoneCheckPath(options.cal)}`,
  ].join("\n");
}

export async function adjust(options: AdjustOptions): Promise<string> {
  const draft = await readDraft(options.cal);
  const isOk =
    options.words.length === 1 && options.words[0].toLowerCase() === "ok";
  return isOk ? confirm(options, draft) : move(options, draft);
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EdgeOffsets } from "./edge-offsets.ts";
import type { LlmRound } from "./llm-refine.ts";
import type { SidePoints } from "./line-fit.ts";
import {
  CalibrationError,
  CORNER_NAMES,
  type CheckResult,
  type Corners,
  type Size,
} from "./types.ts";

export interface Calibration {
  version: 1;
  capture: Size;
  corners: Corners;
  k1: number;
  target: Size;
  created: string;
  checks: CheckResult[];
  adjustments: EdgeOffsets[];
  llm_refine?: { rounds: LlmRound[]; totalTokens?: number };
}

export interface Draft extends Calibration {
  aspect: number;
  source: string;
  edgePoints: SidePoints;
}

export function pendingPath(calPath: string): string {
  return join(dirname(calPath), "calibration.pending.json");
}

export function phoneCheckPath(calPath: string): string {
  return join(dirname(calPath), "phone-check.png");
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSize(value: unknown): value is Size {
  const size = value as Size | undefined;
  return isNumber(size?.width) && isNumber(size?.height);
}

function isPoint(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(isNumber);
}

function hasCorners(value: unknown): boolean {
  const corners = value as Record<string, unknown> | undefined;
  return CORNER_NAMES.every((name) => isPoint(corners?.[name]));
}

function hasCalibrationShape(value: Partial<Calibration>): boolean {
  return (
    isSize(value.capture) &&
    isSize(value.target) &&
    hasCorners(value.corners) &&
    isNumber(value.k1)
  );
}

export function parseCalibration(text: string, label: string): Calibration {
  let value: Partial<Calibration>;
  try {
    value = JSON.parse(text) as Partial<Calibration>;
  } catch {
    throw new CalibrationError(`The file ${label} is not valid JSON.`);
  }
  if (!hasCalibrationShape(value)) {
    throw new CalibrationError(`The file ${label} is not a calibration file.`);
  }
  return value as Calibration;
}

export async function readCalibration(path: string): Promise<Calibration> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new CalibrationError(
      `The calibration file "${path}" cannot be read.`,
    );
  }
  return parseCalibration(text, path);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function assertInputSize(cal: Calibration, size: Size): void {
  const same =
    size.width === cal.capture.width && size.height === cal.capture.height;
  if (!same) {
    throw new CalibrationError(
      `The input size ${size.width}x${size.height} does not match the calibration capture size ${cal.capture.width}x${cal.capture.height}.`,
    );
  }
}

import type { CropRect } from "../method.ts";
import { VideoInputError } from "./types.ts";

export interface GroundTruthEvent {
  time: number;
  rect: CropRect;
  label: string;
}

export interface GroundTruth {
  version: 1;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  events: GroundTruthEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readInteger(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  where: string,
): number {
  const value = source[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum
  ) {
    throw new VideoInputError(
      `${where}: "${key}" must be an integer, ${minimum} or more.`,
    );
  }
  return value;
}

function parseRect(value: unknown, where: string): CropRect {
  if (!isRecord(value)) {
    throw new VideoInputError(`${where}: "rect" must be an object.`);
  }
  return {
    x: readInteger(value, "x", 0, where),
    y: readInteger(value, "y", 0, where),
    width: readInteger(value, "width", 1, where),
    height: readInteger(value, "height", 1, where),
  };
}

function parseTime(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new VideoInputError(
      `${where}: "time" must be a number of seconds, zero or more.`,
    );
  }
  return value;
}

function parseLabel(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") {
    throw new VideoInputError(`${where}: "label" must be a non-empty string.`);
  }
  return value;
}

function parseEvent(value: unknown, position: number): GroundTruthEvent {
  const where = `Event ${position}`;
  if (!isRecord(value)) {
    throw new VideoInputError(`${where} must be an object.`);
  }
  return {
    time: parseTime(value.time, where),
    rect: parseRect(value.rect, where),
    label: parseLabel(value.label, where),
  };
}

export function serializeGroundTruth(truth: GroundTruth): string {
  return `${JSON.stringify(truth, null, 2)}\n`;
}

export function parseGroundTruth(text: string): GroundTruth {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new VideoInputError("The ground-truth file is not valid JSON.");
  }
  if (!isRecord(data) || data.version !== 1) {
    throw new VideoInputError(
      "The ground-truth file must be an object with version 1.",
    );
  }
  if (!Array.isArray(data.events)) {
    throw new VideoInputError('The ground-truth "events" must be an array.');
  }
  return {
    version: 1,
    width: readInteger(data, "width", 1, "Ground truth"),
    height: readInteger(data, "height", 1, "Ground truth"),
    fps: readInteger(data, "fps", 1, "Ground truth"),
    frameCount: readInteger(data, "frameCount", 1, "Ground truth"),
    events: data.events.map((item, index) => parseEvent(item, index)),
  };
}

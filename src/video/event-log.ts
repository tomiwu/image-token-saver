import type { CropRect } from "../method.ts";
import { VideoInputError, type VideoEvent } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTime(value: unknown, position: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new VideoInputError(
      `Event ${position}: "time" must be a number of seconds, zero or more.`,
    );
  }
  return value;
}

function isWholeNumber(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= minimum
  );
}

function rectMessage(position: number): string {
  return `Event ${position}: "rect" needs integer x, y, width, height. Width and height must be 1 or more.`;
}

function readRectField(
  value: Record<string, unknown>,
  key: keyof CropRect,
  minimum: number,
  position: number,
): number {
  const field = value[key];
  if (!isWholeNumber(field, minimum)) {
    throw new VideoInputError(rectMessage(position));
  }
  return field;
}

function parseRect(value: unknown, position: number): CropRect {
  if (!isRecord(value)) {
    throw new VideoInputError(rectMessage(position));
  }
  return {
    x: readRectField(value, "x", 0, position),
    y: readRectField(value, "y", 0, position),
    width: readRectField(value, "width", 1, position),
    height: readRectField(value, "height", 1, position),
  };
}

function parseEvent(value: unknown, position: number): VideoEvent {
  if (!isRecord(value)) {
    throw new VideoInputError(`Event ${position} must be an object.`);
  }
  const time = parseTime(value.time, position);
  if (value.rect === undefined) {
    return { time };
  }
  return { time, rect: parseRect(value.rect, position) };
}

export function parseEventLog(text: string): VideoEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new VideoInputError("The event log is not valid JSON.");
  }
  if (!Array.isArray(data)) {
    throw new VideoInputError("The event log must be a JSON array.");
  }
  return data.map((item, index) => parseEvent(item, index));
}

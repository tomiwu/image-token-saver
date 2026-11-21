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

const RECT_MINIMUM = { x: 0, y: 0, width: 1, height: 1 };

function rectMessage(position: number): string {
  return `Event ${position}: "rect" needs integer x, y, width, height. Width and height must be 1 or more.`;
}

function parseRect(value: unknown, position: number): CropRect {
  if (!isRecord(value)) {
    throw new VideoInputError(rectMessage(position));
  }
  const rect: Record<string, number> = {};
  for (const [key, minimum] of Object.entries(RECT_MINIMUM)) {
    const field = value[key];
    if (!isWholeNumber(field, minimum)) {
      throw new VideoInputError(rectMessage(position));
    }
    rect[key] = field;
  }
  return rect as unknown as CropRect;
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

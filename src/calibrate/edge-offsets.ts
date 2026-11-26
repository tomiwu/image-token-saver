import { applyHomography, homographyToCorners } from "./homography.ts";
import {
  CalibrationError,
  CORNER_NAMES,
  SIDES,
  VIEW_WIDTH,
  rectCorners,
  type Corners,
  type Side,
  type Size,
} from "./types.ts";

export type EdgeOffsets = Partial<Record<Side, number>>;

export function scaleOffsets(
  offsets: EdgeOffsets,
  factor: number,
): EdgeOffsets {
  return Object.fromEntries(
    Object.entries(offsets).map(([side, value]) => [side, value * factor]),
  );
}

export function applyEdgeOffsets(
  corners: Corners,
  target: Size,
  offsets: EdgeOffsets,
): Corners {
  const scale = target.width / VIEW_WIDTH;
  const rect = rectCorners(target);
  const viewPx = { left: 0, right: 0, top: 0, bottom: 0, ...offsets };
  const left = viewPx.left * scale;
  const right = rect.tr[0] - viewPx.right * scale;
  const top = viewPx.top * scale;
  const bottom = rect.bl[1] - viewPx.bottom * scale;
  if (right - left < 1 || bottom - top < 1) {
    throw new CalibrationError("The edge offsets leave no screen area.");
  }
  const moved: Corners = {
    tl: [left, top],
    tr: [right, top],
    br: [right, bottom],
    bl: [left, bottom],
  };
  const h = homographyToCorners(rect, corners);
  return Object.fromEntries(
    CORNER_NAMES.map((name) => [name, applyHomography(h, moved[name])]),
  ) as Corners;
}

function readPair(side: string, text: string): [Side, number] {
  const value = Number(text);
  if (!SIDES.includes(side as Side) || !Number.isFinite(value)) {
    throw new CalibrationError(
      `Cannot read "${side} ${text}". Use top, right, bottom or left and a number.`,
    );
  }
  return [side as Side, value];
}

export function parseOffsets(words: string[]): EdgeOffsets {
  if (words.length === 0 || words.length % 2 !== 0) {
    throw new CalibrationError(
      "Use ok, or pairs such as 'right -10 bottom 8'.",
    );
  }
  const offsets: EdgeOffsets = {};
  for (let i = 0; i < words.length; i += 2) {
    const [side, value] = readPair(words[i], words[i + 1]);
    offsets[side] = (offsets[side] ?? 0) + value;
  }
  return offsets;
}

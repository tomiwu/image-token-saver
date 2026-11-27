export type Point = [number, number];

export const CORNER_NAMES = ["tl", "tr", "br", "bl"] as const;
export type CornerName = (typeof CORNER_NAMES)[number];
export type Corners = Record<CornerName, Point>;

export const SIDES = ["top", "right", "bottom", "left"] as const;
export type Side = (typeof SIDES)[number];

export interface Size {
  width: number;
  height: number;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationError";
  }
}

export const VIEW_WIDTH = 1092;
export const DEFAULT_TARGET: Size = { width: 1872, height: 1404 };
export const DEFAULT_ASPECT = 4 / 3;
export const DEFAULT_WARP_WIDTH = 448;

export function cornerList(corners: Corners): Point[] {
  return CORNER_NAMES.map((name) => corners[name]);
}

export function rectCorners(size: Size): Corners {
  const right = size.width - 1;
  const bottom = size.height - 1;
  return { tl: [0, 0], tr: [right, 0], br: [right, bottom], bl: [0, bottom] };
}

export function heightForWidth(target: Size, width: number): number {
  return Math.round((width * target.height) / target.width);
}

export function viewSize(target: Size, width: number): Size {
  return { width, height: heightForWidth(target, width) };
}

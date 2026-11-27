import sharp from "sharp";
import { undistortPoint } from "../src/calibrate/distortion.ts";
import {
  applyHomography,
  homographyFromPoints,
  invertHomography,
} from "../src/calibrate/homography.ts";
import {
  cornerList,
  type Corners,
  type Point,
} from "../src/calibrate/types.ts";

export const SCENE_CORNERS: Corners = {
  tl: [110, 70],
  tr: [540, 95],
  br: [520, 420],
  bl: [95, 390],
};

const WALL = 90;
const BEZEL = 20;
const PAPER = 240;
const INK = 50;

function uiPixel(u: number, v: number): number {
  const column = Math.floor(u * 8);
  const row = Math.floor(v * 12);
  const inkBlock =
    (column + row) % 3 === 0 && (u * 8) % 1 < 0.6 && (v * 12) % 1 < 0.4;
  return inkBlock ? INK : PAPER;
}

function scenePixel(u: number, v: number, bezel: number): number {
  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
    return uiPixel(u, v);
  }
  const inBezel =
    u >= -bezel && u <= 1 + bezel && v >= -bezel && v <= 1 + bezel;
  return inBezel ? BEZEL : WALL;
}

export async function renderScene(
  width: number,
  height: number,
  corners: Corners = SCENE_CORNERS,
  bezel = 0.04,
  k1 = 0,
): Promise<Buffer> {
  const unit: Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const toUnit = invertHomography(
    homographyFromPoints(unit, cornerList(corners)),
  );
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = applyHomography(
        toUnit,
        undistortPoint([x, y], k1, { width, height }),
      );
      data.fill(
        scenePixel(u, v, bezel),
        (y * width + x) * 3,
        (y * width + x) * 3 + 3,
      );
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

export const PALE_WALL = 245;
export const PALE_BEZEL = 252;
export const PALE_PAPER = 218;
export const PALE_INK = 60;

function palePixel(u: number, v: number, bezel: number): number {
  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
    const column = Math.floor(u * 8);
    const row = Math.floor(v * 12);
    const inkBlock =
      (column + row) % 3 === 0 && (u * 8) % 1 < 0.6 && (v * 12) % 1 < 0.4;
    return inkBlock ? PALE_INK : PALE_PAPER;
  }
  const inBezel =
    u >= -bezel && u <= 1 + bezel && v >= -bezel && v <= 1 + bezel;
  return inBezel ? PALE_BEZEL : PALE_WALL;
}

function paintPixel(
  data: Buffer,
  width: number,
  x: number,
  y: number,
  value: number,
): void {
  if (x < 0 || y < 0 || x >= width) {
    return;
  }
  const i = (y * width + x) * 3;
  if (i < 0 || i + 2 >= data.length) {
    return;
  }
  data.fill(value, i, i + 3);
}

function addDarkCables(
  data: Buffer,
  width: number,
  height: number,
  startX: number,
): void {
  for (let i = 0; i < 5; i++) {
    drawCable(data, width, height, startX + 8 + i * 10, i);
  }
}

function drawCable(
  data: Buffer,
  width: number,
  height: number,
  base: number,
  index: number,
): void {
  for (let y = 0; y < height; y++) {
    const x = Math.round(
      base + 6 * Math.sin(y / 18 + index) + (index % 2) * 3 * Math.cos(y / 11),
    );
    paintPixel(data, width, x, y, 18);
    paintPixel(data, width, x + 1, y, 24);
  }
}

export async function renderPaleCabledScene(
  width: number,
  height: number,
  corners: Corners = SCENE_CORNERS,
  bezel = 0.05,
): Promise<Buffer> {
  const unit: Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const toUnit = invertHomography(
    homographyFromPoints(unit, cornerList(corners)),
  );
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = applyHomography(toUnit, [x, y]);
      data.fill(
        palePixel(u, v, bezel),
        (y * width + x) * 3,
        (y * width + x) * 3 + 3,
      );
    }
  }
  const right = Math.max(corners.tr[0], corners.br[0]);
  addDarkCables(data, width, height, Math.min(width - 8, right + 18));
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

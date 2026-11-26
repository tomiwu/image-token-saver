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

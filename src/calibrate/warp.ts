import sharp from "sharp";
import { distortPoint } from "./distortion.ts";
import {
  applyHomography,
  homographyToCorners,
  type Matrix3,
} from "./homography.ts";
import { rectCorners, type Corners, type Size } from "./types.ts";

export interface WarpGeometry {
  corners: Corners;
  k1: number;
  capture: Size;
}

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

const CHANNELS = 3;

export async function decodeRgb(input: Uint8Array): Promise<RawImage> {
  const { data, info } = await sharp(input)
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function channelAt(image: RawImage, x: number, y: number, c: number): number {
  return image.data[(y * image.width + x) * CHANNELS + c];
}

function sampleChannel(image: RawImage, u: number, v: number, c: number) {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const top =
    channelAt(image, x0, y0, c) * (1 - fx) +
    channelAt(image, x0 + 1, y0, c) * fx;
  const bottom =
    channelAt(image, x0, y0 + 1, c) * (1 - fx) +
    channelAt(image, x0 + 1, y0 + 1, c) * fx;
  return top * (1 - fy) + bottom * fy;
}

function insideSource(image: RawImage, u: number, v: number): boolean {
  return u >= 0 && v >= 0 && u < image.width - 1 && v < image.height - 1;
}

function writePixel(
  out: Buffer,
  offset: number,
  image: RawImage,
  source: [number, number],
): void {
  if (!insideSource(image, source[0], source[1])) {
    return;
  }
  for (let c = 0; c < CHANNELS; c++) {
    out[offset + c] = Math.round(sampleChannel(image, source[0], source[1], c));
  }
}

export function frontHomography(geometry: WarpGeometry, size: Size): Matrix3 {
  return homographyToCorners(rectCorners(size), geometry.corners);
}

export function warpRaw(
  image: RawImage,
  geometry: WarpGeometry,
  size: Size,
): RawImage {
  const h = frontHomography(geometry, size);
  const out = Buffer.alloc(size.width * size.height * CHANNELS);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const undistorted = applyHomography(h, [x, y]);
      const source = distortPoint(undistorted, geometry.k1, geometry.capture);
      writePixel(out, (y * size.width + x) * CHANNELS, image, source);
    }
  }
  return { data: out, width: size.width, height: size.height };
}

export async function encodePng(image: RawImage): Promise<Buffer> {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: CHANNELS },
  })
    .png()
    .toBuffer();
}

export async function warpToPng(
  input: Uint8Array,
  geometry: WarpGeometry,
  size: Size,
): Promise<Buffer> {
  const raw = warpRaw(await decodeRgb(input), geometry, size);
  return encodePng(raw);
}

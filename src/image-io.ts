import { readFile } from "node:fs/promises";
import sharp from "sharp";

export type ImageInput = string | Uint8Array;

export interface ImageInfo {
  width: number;
  height: number;
  channels: number;
}

export async function loadImageBytes(input: ImageInput): Promise<Uint8Array> {
  return typeof input === "string" ? readFile(input) : input;
}

export async function readImageInfo(input: ImageInput): Promise<ImageInfo> {
  const bytes = await loadImageBytes(input);
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("The image has no readable size.");
  }
  return {
    width: meta.width,
    height: meta.height,
    channels: meta.channels ?? 3,
  };
}

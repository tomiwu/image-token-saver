import sharp from "sharp";
import type { Size } from "./types.ts";

export interface GrayImage extends Size {
  data: Uint8Array;
}

export async function loadGray(input: Uint8Array): Promise<GrayImage> {
  const { data, info } = await sharp(input)
    .greyscale()
    .blur(1.5)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

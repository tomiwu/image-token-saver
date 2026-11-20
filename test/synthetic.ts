import sharp from "sharp";

export async function syntheticImage(
  width: number,
  height: number,
  channels: 1 | 3,
): Promise<Buffer> {
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        data[(y * width + x) * channels + c] = (x + y * 2 + c * 64) & 255;
      }
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

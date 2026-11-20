import sharp from "sharp";
import { estimateTokens, type TargetModel } from "./estimators.ts";
import { loadImageBytes, readImageInfo, type ImageInput } from "./image-io.ts";
import type { MethodResult, ReductionMethod } from "./method.ts";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class CropError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CropError";
  }
}

export interface CropResult {
  image: Uint8Array;
  width: number;
  height: number;
  estimatedTokens: number;
}

function validateRect(
  rect: CropRect,
  imageWidth: number,
  imageHeight: number,
): void {
  for (const key of ["x", "y", "width", "height"] as const) {
    if (!Number.isInteger(rect[key])) {
      throw new CropError(`The crop value "${key}" must be an integer.`);
    }
  }
  if (rect.x < 0 || rect.y < 0) {
    throw new CropError("The crop origin must not be negative.");
  }
  if (rect.width < 1 || rect.height < 1) {
    throw new CropError("The crop width and height must be at least 1.");
  }
  if (rect.x + rect.width > imageWidth || rect.y + rect.height > imageHeight) {
    throw new CropError(
      `The crop rectangle is outside the image (${imageWidth}x${imageHeight}).`,
    );
  }
}

export async function cropRegion(
  input: ImageInput,
  rect: CropRect,
  model: TargetModel,
): Promise<CropResult> {
  const info = await readImageInfo(input);
  validateRect(rect, info.width, info.height);
  const bytes = await loadImageBytes(input);
  const image = await sharp(bytes)
    .extract({
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
    })
    .png()
    .toBuffer();
  return {
    image,
    width: rect.width,
    height: rect.height,
    estimatedTokens: estimateTokens(rect.width, rect.height, model),
  };
}

export const cropMethod: ReductionMethod = {
  name: "crop",
  async apply(request): Promise<MethodResult | undefined> {
    if (!request.region) {
      return undefined;
    }
    const result = await cropRegion(
      request.image,
      request.region,
      request.model,
    );
    return { method: "crop", ...result };
  },
};

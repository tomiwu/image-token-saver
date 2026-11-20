import sharp from "sharp";
import {
  estimateClaude,
  estimateGpt4oTiles,
  estimateGptPatch,
  estimateTokens,
} from "./estimators.ts";
import type { TargetModel } from "./estimators.ts";
import { loadImageBytes, readImageInfo } from "./image-io.ts";
import type { MethodRequest, MethodResult, ReductionMethod } from "./method.ts";

const BEST_SIZE_BY_MODEL: Record<
  TargetModel,
  (width: number, height: number) => { width: number; height: number }
> = {
  "claude-standard": (width, height) =>
    estimateClaude(width, height, "standard"),
  "claude-high-res": (width, height) =>
    estimateClaude(width, height, "high-res"),
  "gpt-4o": (width, height) => estimateGpt4oTiles(width, height, "high"),
  "gpt-4.1-mini": (width, height) =>
    estimateGptPatch(width, height, "gpt-4.1-mini"),
  "gpt-5.2": (width, height) => estimateGptPatch(width, height, "gpt-5.2"),
  "gemini-3": (width, height) => ({ width, height }),
};

export function bestSize(
  width: number,
  height: number,
  model: TargetModel,
): { width: number; height: number } {
  return BEST_SIZE_BY_MODEL[model](width, height);
}

export function unreducedTokens(
  width: number,
  height: number,
  model: TargetModel,
): number {
  if (model === "claude-standard" || model === "claude-high-res") {
    return estimateClaude(width, height, "raw").tokens;
  }
  return estimateTokens(width, height, model);
}

export const resizeMethod: ReductionMethod = {
  name: "resize",
  async apply(request: MethodRequest): Promise<MethodResult | undefined> {
    const info = await readImageInfo(request.image);
    const target = bestSize(info.width, info.height, request.model);
    if (target.width === info.width && target.height === info.height) {
      return undefined;
    }
    const bytes = await loadImageBytes(request.image);
    const image = await sharp(bytes)
      .resize(target.width, target.height, { fit: "fill" })
      .png()
      .toBuffer();
    return {
      method: "resize",
      image,
      width: target.width,
      height: target.height,
      estimatedTokens: estimateTokens(
        target.width,
        target.height,
        request.model,
      ),
    };
  },
};

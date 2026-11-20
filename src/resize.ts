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

export function bestSize(
  width: number,
  height: number,
  model: TargetModel,
): { width: number; height: number } {
  switch (model) {
    case "claude-standard":
      return estimateClaude(width, height, "standard");
    case "claude-high-res":
      return estimateClaude(width, height, "high-res");
    case "gpt-4o":
      return estimateGpt4oTiles(width, height, "high");
    case "gpt-4.1-mini":
    case "gpt-5.2":
      return estimateGptPatch(width, height, model);
    case "gemini-3":
      return { width, height };
  }
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

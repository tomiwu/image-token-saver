import sharp from "sharp";
import { estimateTokens } from "../estimators.ts";
import { loadImageBytes } from "../image-io.ts";
import type {
  MethodRequest,
  MethodResult,
  ReductionMethod,
} from "../method.ts";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RawFrame {
  data: Buffer;
  width: number;
  height: number;
}

async function readRaw(bytes: Uint8Array): Promise<RawFrame> {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function findChangedRect(a: RawFrame, b: RawFrame): Rect | undefined {
  const { width, height, data: aData } = a;
  const bData = b.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        aData[i] !== bData[i] ||
        aData[i + 1] !== bData[i + 1] ||
        aData[i + 2] !== bData[i + 2] ||
        aData[i + 3] !== bData[i + 3]
      ) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) {
    return undefined;
  }
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export const diffMethod: ReductionMethod = {
  name: "diff",
  async apply(request: MethodRequest): Promise<MethodResult | undefined> {
    if (request.previous === undefined) {
      return undefined;
    }
    const [imageBytes, previousBytes] = await Promise.all([
      loadImageBytes(request.image),
      loadImageBytes(request.previous),
    ]);
    const [current, previous] = await Promise.all([
      readRaw(imageBytes),
      readRaw(previousBytes),
    ]);
    if (
      current.width !== previous.width ||
      current.height !== previous.height
    ) {
      return undefined;
    }
    const rect = findChangedRect(current, previous);
    if (rect === undefined) {
      return {
        method: "diff",
        text: "No change from the previous frame.",
        estimatedTokens: 0,
      };
    }
    const image = await sharp(imageBytes).extract(rect).png().toBuffer();
    return {
      method: "diff",
      image,
      text: `Changed region: left=${rect.left} top=${rect.top} width=${rect.width} height=${rect.height} of ${current.width}x${current.height}.`,
      width: rect.width,
      height: rect.height,
      estimatedTokens: estimateTokens(rect.width, rect.height, request.model),
    };
  },
};

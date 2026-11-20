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

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function pixelsDiffer(aData: Buffer, bData: Buffer, i: number): boolean {
  for (let channel = 0; channel < 4; channel++) {
    if (aData[i + channel] !== bData[i + channel]) {
      return true;
    }
  }
  return false;
}

function emptyBounds(width: number, height: number): Bounds {
  return { minX: width, minY: height, maxX: -1, maxY: -1 };
}

function includePoint(bounds: Bounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function rectFromBounds(bounds: Bounds): Rect | undefined {
  if (bounds.maxX < 0) {
    return undefined;
  }
  return {
    left: bounds.minX,
    top: bounds.minY,
    width: bounds.maxX - bounds.minX + 1,
    height: bounds.maxY - bounds.minY + 1,
  };
}

function findChangedRect(a: RawFrame, b: RawFrame): Rect | undefined {
  const { width, height, data: aData } = a;
  const bData = b.data;
  const bounds = emptyBounds(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixelsDiffer(aData, bData, i)) {
        includePoint(bounds, x, y);
      }
    }
  }
  return rectFromBounds(bounds);
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

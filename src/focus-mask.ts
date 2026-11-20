import sharp from "sharp";
import { estimateTokens } from "./estimators.ts";
import { loadImageBytes } from "./image-io.ts";
import type { MethodResult, ReductionMethod } from "./method.ts";

/**
 * Official token formulas use the full width and height of the image.
 * This method keeps the canvas size unless the caller sets `resizeTo`.
 * It improves focus at a given size. It does not cut formula tokens
 * on its own. Combine it with a resize or a crop to cut tokens.
 */

export interface FocusRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FocusMaskOptions {
  region: FocusRegion;
  mode: "blur" | "downsample";
  blurSigma?: number;
  downsampleFactor?: number;
  resizeTo?: { width: number; height: number };
}

const DEFAULT_SIGMA = 8;
const DEFAULT_FACTOR = 4;

function requireWholeNumbers(region: FocusRegion): void {
  const values = [region.left, region.top, region.width, region.height];
  if (!values.every(Number.isInteger)) {
    throw new Error("The region must use whole numbers.");
  }
}

function requireOrigin(region: FocusRegion): void {
  if (region.left < 0 || region.top < 0) {
    throw new Error("The region must be inside the image.");
  }
}

function requireSize(region: FocusRegion): void {
  if (region.width < 1 || region.height < 1) {
    throw new Error("The region must be inside the image.");
  }
}

function requireInside(
  region: FocusRegion,
  width: number,
  height: number,
): void {
  if (
    region.left + region.width > width ||
    region.top + region.height > height
  ) {
    throw new Error("The region must be inside the image.");
  }
}

function checkRegion(region: FocusRegion, width: number, height: number): void {
  requireWholeNumbers(region);
  requireOrigin(region);
  requireSize(region);
  requireInside(region, width, height);
}

async function softenedBackground(
  bytes: Uint8Array,
  options: FocusMaskOptions,
  width: number,
  height: number,
): Promise<Buffer> {
  if (options.mode === "blur") {
    return sharp(bytes)
      .blur(options.blurSigma ?? DEFAULT_SIGMA)
      .png()
      .toBuffer();
  }
  const factor = options.downsampleFactor ?? DEFAULT_FACTOR;
  const small = await sharp(bytes)
    .resize(
      Math.max(1, Math.round(width / factor)),
      Math.max(1, Math.round(height / factor)),
      { kernel: "lanczos3" },
    )
    .toBuffer();
  return sharp(small)
    .resize(width, height, { kernel: "nearest" })
    .png()
    .toBuffer();
}

async function renderFocusMask(
  source: Uint8Array,
  options: FocusMaskOptions,
  width: number,
  height: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  const background = await softenedBackground(source, options, width, height);
  const regionPatch = await sharp(source)
    .extract(options.region)
    .png()
    .toBuffer();
  let pipeline = sharp(background).composite([
    {
      input: regionPatch,
      left: options.region.left,
      top: options.region.top,
    },
  ]);
  if (options.resizeTo) {
    pipeline = sharp(await pipeline.png().toBuffer()).resize(
      options.resizeTo.width,
      options.resizeTo.height,
    );
  }
  const { data, info } = await pipeline
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function createFocusMaskMethod(
  options: FocusMaskOptions,
): ReductionMethod {
  return {
    name: "focus-mask",
    async apply(request): Promise<MethodResult> {
      const bytes = await loadImageBytes(request.image);
      const meta = await sharp(bytes).metadata();
      if (!meta.width || !meta.height) {
        throw new Error("The image has no readable size.");
      }
      const { width, height } = meta;
      checkRegion(options.region, width, height);

      const rendered = await renderFocusMask(bytes, options, width, height);
      return {
        method: "focus-mask",
        image: rendered.data,
        width: rendered.width,
        height: rendered.height,
        estimatedTokens: estimateTokens(
          rendered.width,
          rendered.height,
          request.model,
        ),
      };
    },
  };
}

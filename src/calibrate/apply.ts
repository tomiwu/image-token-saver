import { readFile } from "node:fs/promises";
import {
  assertInputSize,
  readCalibration,
  type Calibration,
} from "./calibration-file.ts";
import { DEFAULT_WARP_WIDTH, viewSize, type Size } from "./types.ts";
import { decodeRgb, encodePng, warpRaw } from "./warp.ts";

export interface Warper {
  cal: Calibration;
  size: Size;
  warp(input: string | Uint8Array): Promise<Buffer>;
}

export async function loadWarper(
  calPath: string,
  width: number = DEFAULT_WARP_WIDTH,
): Promise<Warper> {
  const cal = await readCalibration(calPath);
  const size = viewSize(cal.target, width);
  return {
    cal,
    size,
    async warp(input) {
      const bytes = typeof input === "string" ? await readFile(input) : input;
      const image = await decodeRgb(bytes);
      assertInputSize(cal, image);
      const geometry = {
        corners: cal.corners,
        k1: cal.k1,
        capture: cal.capture,
      };
      return encodePng(warpRaw(image, geometry, size));
    },
  };
}

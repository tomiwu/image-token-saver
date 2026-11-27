import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { assertInputSize, readCalibration } from "./calibration-file.ts";
import { CalibrationError, type Size } from "./types.ts";

export const CAPTURE_SIZE: Size = { width: 1920, height: 1080 };
export const DEFAULT_FPS = 30;
export const DEFAULT_CLIP_SECONDS = 3;

export type CaptureKind = "still" | "clip";

export interface CaptureOptions {
  kind: CaptureKind;
  out: string;
  seconds?: number;
  cal?: string;
  size?: Size;
  fps?: number;
}

export function captureSize(options: CaptureOptions): Size {
  return options.size ?? CAPTURE_SIZE;
}

export function captureFps(options: CaptureOptions): number {
  return options.fps ?? DEFAULT_FPS;
}

export function inputArgs(size: Size, fps: number): string[] {
  return [
    "-hide_banner",
    "-y",
    "-f",
    "avfoundation",
    "-framerate",
    String(fps),
    "-video_size",
    `${size.width}x${size.height}`,
    "-pixel_format",
    "uyvy422",
    "-i",
    "0:none",
  ];
}

export function captureArgs(options: CaptureOptions): string[] {
  const input = inputArgs(captureSize(options), captureFps(options));
  if (options.kind === "still") {
    return [...input, "-frames:v", "1", "-update", "1", options.out];
  }
  return clipArgs(input, options);
}

function clipArgs(input: string[], options: CaptureOptions): string[] {
  const seconds = options.seconds ?? DEFAULT_CLIP_SECONDS;
  return [
    ...input,
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "23",
    options.out,
  ];
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("error", () =>
      reject(new CalibrationError("ffmpeg was not found. Install ffmpeg.")),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new CalibrationError(`ffmpeg exited with code ${code}.`)),
    );
  });
}

async function assertStillSize(path: string, expected: Size): Promise<void> {
  const meta = await sharp(path).metadata();
  const size = { width: meta.width ?? 0, height: meta.height ?? 0 };
  if (size.width !== expected.width || size.height !== expected.height) {
    throw new CalibrationError(
      `The camera returned ${size.width}x${size.height}. The capture size must be ${expected.width}x${expected.height}.`,
    );
  }
}

export async function runCapture(options: CaptureOptions): Promise<string> {
  const size = captureSize(options);
  if (options.cal) {
    assertInputSize(await readCalibration(options.cal), size);
  }
  await mkdir(dirname(options.out), { recursive: true });
  await runFfmpeg(captureArgs(options));
  if (options.kind === "still") {
    await assertStillSize(options.out, size);
  }
  return `${options.kind}=${options.out} size=${size.width}x${size.height}`;
}

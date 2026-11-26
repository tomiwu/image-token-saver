import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { CropRect } from "../method.ts";
import {
  serializeGroundTruth,
  type GroundTruth,
  type GroundTruthEvent,
} from "./ground-truth.ts";

export interface Layer {
  label: string;
  rect: CropRect;
  grey: number;
  from: number;
  until?: number;
}

export interface Ghost {
  rect: CropRect;
  peak: number;
}

export interface Scenario {
  name: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  seed: number;
  layers: Layer[];
  noise: number;
  flicker: number;
  ghost?: Ghost;
}

export interface Clip {
  name: string;
  folder: string;
  video: string;
  truthPath: string;
  truth: GroundTruth;
}

const BASE_GREY = 40;

export const SCENARIOS: Scenario[] = [
  {
    name: "change-dialog",
    width: 96,
    height: 64,
    fps: 5,
    frameCount: 10,
    seed: 1,
    noise: 0,
    flicker: 0,
    layers: [
      {
        label: "dialog-opens",
        rect: { x: 20, y: 12, width: 40, height: 30 },
        grey: 220,
        from: 4,
      },
    ],
  },
  {
    name: "change-two-panels",
    width: 96,
    height: 64,
    fps: 5,
    frameCount: 12,
    seed: 2,
    noise: 0,
    flicker: 0,
    layers: [
      {
        label: "left-panel",
        rect: { x: 4, y: 8, width: 24, height: 20 },
        grey: 200,
        from: 3,
      },
      {
        label: "right-panel",
        rect: { x: 60, y: 36, width: 30, height: 18 },
        grey: 120,
        from: 8,
      },
    ],
  },
  {
    name: "change-toast",
    width: 96,
    height: 64,
    fps: 10,
    frameCount: 16,
    seed: 3,
    noise: 0,
    flicker: 0,
    layers: [
      {
        label: "toast",
        rect: { x: 50, y: 2, width: 44, height: 12 },
        grey: 255,
        from: 5,
        until: 11,
      },
    ],
  },
  {
    name: "change-noisy-badge",
    width: 96,
    height: 64,
    fps: 5,
    frameCount: 10,
    seed: 4,
    noise: 2,
    flicker: 0,
    layers: [
      {
        label: "badge",
        rect: { x: 70, y: 4, width: 16, height: 16 },
        grey: 255,
        from: 6,
      },
    ],
  },
  {
    name: "still-noise-flicker",
    width: 96,
    height: 64,
    fps: 5,
    frameCount: 10,
    seed: 5,
    noise: 2,
    flicker: 2,
    layers: [],
  },
  {
    name: "still-ghosting",
    width: 96,
    height: 64,
    fps: 5,
    frameCount: 10,
    seed: 6,
    noise: 1,
    flicker: 0,
    layers: [],
    ghost: { rect: { x: 10, y: 10, width: 50, height: 30 }, peak: 6 },
  },
];

function nextRandom(state: { value: number }): number {
  state.value = (state.value + 0x6d2b79f5) >>> 0;
  let t = state.value;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function inside(rect: CropRect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

function ghostLevel(scenario: Scenario, frame: number): number {
  const ghost = scenario.ghost;
  if (!ghost) {
    return 0;
  }
  const remaining = 1 - frame / scenario.frameCount;
  return Math.round(ghost.peak * remaining);
}

function layerAt(scenario: Scenario, frame: number): Layer[] {
  return scenario.layers.filter(
    (layer) =>
      frame >= layer.from && (layer.until === undefined || frame < layer.until),
  );
}

function pixelGrey(
  scenario: Scenario,
  active: Layer[],
  x: number,
  y: number,
  ghost: number,
): number {
  const top = active.find((layer) => inside(layer.rect, x, y));
  if (top) {
    return top.grey;
  }
  const gradient = (x + y) % 16;
  const ghosted =
    scenario.ghost && inside(scenario.ghost.rect, x, y) ? ghost : 0;
  return BASE_GREY + gradient + ghosted;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}

export async function renderFrame(
  scenario: Scenario,
  frame: number,
): Promise<Buffer> {
  const { width, height } = scenario;
  const random = { value: (scenario.seed * 7919 + frame * 104729) >>> 0 };
  const active = layerAt(scenario, frame);
  const ghost = ghostLevel(scenario, frame);
  const flicker =
    scenario.flicker === 0 ? 0 : frame % 2 === 0 ? 0 : scenario.flicker;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const jitter = Math.round((nextRandom(random) * 2 - 1) * scenario.noise);
      const grey = clamp(
        pixelGrey(scenario, active, x, y, ghost) + flicker + jitter,
      );
      data.fill(grey, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

export function groundTruthFor(scenario: Scenario): GroundTruth {
  const events: GroundTruthEvent[] = [];
  for (const layer of scenario.layers) {
    events.push({
      time: layer.from / scenario.fps,
      rect: layer.rect,
      label: `${layer.label}-appears`,
    });
    if (layer.until !== undefined) {
      events.push({
        time: layer.until / scenario.fps,
        rect: layer.rect,
        label: `${layer.label}-disappears`,
      });
    }
  }
  events.sort((a, b) => a.time - b.time);
  return {
    version: 1,
    width: scenario.width,
    height: scenario.height,
    fps: scenario.fps,
    frameCount: scenario.frameCount,
    events,
  };
}

function encode(framesDir: string, fps: number, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-framerate",
      String(fps),
      "-i",
      join(framesDir, "frame-%04d.png"),
      "-c:v",
      "libx264",
      "-qp",
      "0",
      "-pix_fmt",
      "yuv444p",
      output,
    ]);
    child.on("error", () => {
      reject(new Error("ffmpeg was not found. Install ffmpeg 7 on PATH."));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}.`));
    });
  });
}

export async function generateClip(
  scenario: Scenario,
  outDir: string,
): Promise<Clip> {
  const folder = join(outDir, scenario.name);
  await mkdir(folder, { recursive: true });
  for (let frame = 0; frame < scenario.frameCount; frame++) {
    const name = `frame-${String(frame + 1).padStart(4, "0")}.png`;
    await writeFile(join(folder, name), await renderFrame(scenario, frame));
  }
  const truth = groundTruthFor(scenario);
  const truthPath = join(outDir, `${scenario.name}.truth.json`);
  await writeFile(truthPath, serializeGroundTruth(truth));
  const video = join(outDir, `${scenario.name}.mp4`);
  await encode(folder, scenario.fps, video);
  return { name: scenario.name, folder, video, truthPath, truth };
}

export async function generateAll(outDir: string): Promise<Clip[]> {
  await mkdir(outDir, { recursive: true });
  const clips: Clip[] = [];
  for (const scenario of SCENARIOS) {
    clips.push(await generateClip(scenario, outDir));
  }
  return clips;
}

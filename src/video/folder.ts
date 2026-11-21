import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { VideoInputError, type FrameSet } from "./types.ts";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(name).toLowerCase());
}

export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export async function readFolderFrames(
  dir: string,
  fps: number,
): Promise<FrameSet> {
  const names = (await readdir(dir)).filter(isImageName).sort(compareNames);
  if (names.length === 0) {
    throw new VideoInputError(
      "The folder has no image files. Use png, jpg, jpeg, or webp.",
    );
  }
  return {
    source: "folder",
    frames: names.map((name, index) => ({
      index,
      timestamp: index / fps,
      path: join(dir, name),
    })),
  };
}

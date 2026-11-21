import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { VideoInputError, type FrameSet } from "./types.ts";

const PTS_PATTERN = /pts_time:(-?[0-9.]+)/g;

export function parseTimestamps(log: string): number[] {
  return [...log.matchAll(PTS_PATTERN)].map(
    (match) => Math.round(Number(match[1]) * 1e6) / 1e6,
  );
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    let log = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      log += chunk;
    });
    child.on("error", () => {
      reject(
        new VideoInputError("ffmpeg was not found. Install ffmpeg 7 on PATH."),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(log);
        return;
      }
      reject(
        new VideoInputError(
          "ffmpeg could not read the video. The file may be damaged.",
        ),
      );
    });
  });
}

export async function readVideoFrames(
  input: string,
  outDir: string,
): Promise<FrameSet> {
  await mkdir(outDir, { recursive: true });
  const log = await runFfmpeg([
    "-hide_banner",
    "-nostdin",
    "-i",
    input,
    "-an",
    "-fps_mode",
    "passthrough",
    "-vf",
    "showinfo",
    join(outDir, "frame-%06d.png"),
  ]);
  const timestamps = parseTimestamps(log);
  const names = (await readdir(outDir))
    .filter((n) => n.endsWith(".png"))
    .sort();
  if (names.length === 0 || names.length !== timestamps.length) {
    throw new VideoInputError("ffmpeg returned no usable frames.");
  }
  return {
    source: "video",
    frames: names.map((name, index) => ({
      index,
      timestamp: timestamps[index],
      path: join(outDir, name),
    })),
  };
}

import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { CliError, requireValue } from "../cli-args.ts";
import { parseEventLog } from "./event-log.ts";
import { readVideoFrames } from "./ffmpeg.ts";
import { readFolderFrames } from "./folder.ts";
import { VideoInputError, type FrameSet, type VideoEvent } from "./types.ts";

export interface VideoArgs {
  input: string;
  events?: string;
  outDir?: string;
  fps: number;
  json: boolean;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov"]);

export function videoUsage(): string {
  return "  image-token-saver video <file.mp4|file.mov|folder> [--events <log.json>] [--out-dir <dir>] [--fps <n>] [--json]";
}

function parseFps(value: string): number {
  const fps = Number(value);
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new CliError("The --fps value must be greater than 0.");
  }
  return fps;
}

type PartialVideoArgs = Partial<VideoArgs> & { positionals: string[] };

function setEvents(args: PartialVideoArgs, value: string): void {
  args.events = value;
}

function setOutDir(args: PartialVideoArgs, value: string): void {
  args.outDir = value;
}

function setFps(args: PartialVideoArgs, value: string): void {
  args.fps = parseFps(value);
}

const VALUE_FLAGS: Record<
  string,
  (args: PartialVideoArgs, value: string) => void
> = {
  "--events": setEvents,
  "--out-dir": setOutDir,
  "--fps": setFps,
};

function applyFlag(
  args: PartialVideoArgs,
  tokens: string[],
  index: number,
): number {
  const flag = tokens[index];
  if (flag === "--json") {
    args.json = true;
    return index + 1;
  }
  const setter = VALUE_FLAGS[flag];
  if (!setter) {
    throw new CliError(`Unknown flag "${flag}".`);
  }
  setter(args, requireValue(flag, tokens[index + 1]));
  return index + 2;
}

export function parseVideoArgs(argv: string[]): VideoArgs {
  const args: PartialVideoArgs = { positionals: [] };
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token.startsWith("--")) {
      index = applyFlag(args, argv, index);
    } else {
      args.positionals.push(token);
      index += 1;
    }
  }
  if (!args.positionals[0]) {
    throw new CliError("A video file or image folder path is required.");
  }
  return {
    input: args.positionals[0],
    events: args.events,
    outDir: args.outDir,
    fps: args.fps ?? 1,
    json: Boolean(args.json),
  };
}

async function statInput(input: string): Promise<"file" | "folder"> {
  try {
    return (await stat(input)).isDirectory() ? "folder" : "file";
  } catch {
    throw new VideoInputError(`The input "${input}" does not exist.`);
  }
}

async function readFrames(args: VideoArgs): Promise<FrameSet> {
  const kind = await statInput(args.input);
  if (kind === "folder") {
    return readFolderFrames(args.input, args.fps);
  }
  if (!VIDEO_EXTENSIONS.has(extname(args.input).toLowerCase())) {
    throw new VideoInputError("Use an mp4 or mov file, or a folder of images.");
  }
  const outDir =
    args.outDir ?? (await mkdtemp(join(tmpdir(), "image-token-saver-")));
  return readVideoFrames(args.input, outDir);
}

async function readEvents(path?: string): Promise<VideoEvent[] | undefined> {
  if (!path) {
    return undefined;
  }
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new VideoInputError(`The event log "${path}" cannot be read.`);
  }
  return parseEventLog(text);
}

function formatPlain(set: FrameSet, events?: VideoEvent[]): string {
  const lines = [`source=${set.source} frames=${set.frames.length}`];
  for (const frame of set.frames) {
    lines.push(
      `index=${frame.index} time=${frame.timestamp} path=${frame.path}`,
    );
  }
  if (events) {
    lines.push(`events=${events.length}`);
  }
  return lines.join("\n");
}

export async function runVideo(args: VideoArgs): Promise<string> {
  const events = await readEvents(args.events);
  const set = await readFrames(args);
  if (args.json) {
    return JSON.stringify({ ...set, events });
  }
  return formatPlain(set, events);
}

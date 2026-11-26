import { CliError, requireValue } from "../cli-args.ts";
import { adjust } from "./adjust.ts";
import { calibrate, type CalibrateOptions } from "./calibrate.ts";
import {
  CAPTURE_SIZE,
  DEFAULT_CLIP_SECONDS,
  runCapture,
  type CaptureKind,
} from "./capture.ts";
import type { Panel } from "./detect.ts";
import { createClaudeRefiner } from "./llm-claude.ts";
import {
  DEFAULT_ASPECT,
  DEFAULT_TARGET,
  DEFAULT_WARP_WIDTH,
  type Size,
} from "./types.ts";

export function calibrateUsage(): string[] {
  return [
    "  image-token-saver calibrate --image <frame> [--out calibration.json] [--target WxH] [--aspect W:H] [--panel auto|light|dark] [--llm] [--llm-width <px>]",
    "  image-token-saver calibrate adjust <ok | side offset ...> [--cal calibration.json]",
    `  image-token-saver capture <still|clip> <out> [--seconds <n>] [--cal calibration.json]  (macOS, ${CAPTURE_SIZE.width}x${CAPTURE_SIZE.height})`,
    `  --cal <calibration.json> [--width <px>] on estimate, reduce and video warps the input first (default width ${DEFAULT_WARP_WIDTH}).`,
  ];
}

export function parseTarget(value: string): Size {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) {
    throw new CliError(
      'The --target value must be "WxH", for example 1872x1404.',
    );
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function parseAspect(value: string): number {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match || Number(match[2]) < 1) {
    throw new CliError('The --aspect value must be "W:H", for example 4:3.');
  }
  return Number(match[1]) / Number(match[2]);
}

export function parsePanel(value: string): Panel {
  if (value !== "auto" && value !== "light" && value !== "dark") {
    throw new CliError("The --panel value must be auto, light, or dark.");
  }
  return value;
}

export function parsePositive(flag: string, value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new CliError(`The ${flag} value must be a positive integer.`);
  }
  return number;
}

interface Flags {
  values: Map<string, string>;
  switches: Set<string>;
  words: string[];
}

const SWITCHES = new Set(["--llm"]);

export function splitFlags(argv: string[]): Flags {
  const flags: Flags = { values: new Map(), switches: new Set(), words: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (SWITCHES.has(token)) {
      flags.switches.add(token);
    } else if (token.startsWith("--")) {
      flags.values.set(token, requireValue(token, argv[i + 1]));
      i++;
    } else {
      flags.words.push(token);
    }
  }
  return flags;
}

function requireFlag(flags: Flags, name: string): string {
  const value = flags.values.get(name);
  if (value === undefined) {
    throw new CliError(`The ${name} flag is required.`);
  }
  return value;
}

function optionalNumber(flags: Flags, name: string): number | undefined {
  const value = flags.values.get(name);
  return value === undefined ? undefined : parsePositive(name, value);
}

async function runAdjust(argv: string[]): Promise<string> {
  const flags = splitFlags(argv);
  return adjust({
    cal: flags.values.get("--cal") ?? "calibration.json",
    words: flags.words,
  });
}

function parseFlag<T>(
  flags: Flags,
  name: string,
  parse: (value: string) => T,
  fallback: T,
): T {
  const value = flags.values.get(name);
  return value === undefined ? fallback : parse(value);
}

function calibrateOptions(flags: Flags): CalibrateOptions {
  return {
    image: requireFlag(flags, "--image"),
    out: flags.values.get("--out") ?? "calibration.json",
    target: parseFlag(flags, "--target", parseTarget, DEFAULT_TARGET),
    aspect: parseFlag(flags, "--aspect", parseAspect, DEFAULT_ASPECT),
    panel: parseFlag(flags, "--panel", parsePanel, "auto" as Panel),
    llm: flags.switches.has("--llm") ? createClaudeRefiner() : undefined,
    llmWidth: optionalNumber(flags, "--llm-width"),
  };
}

export async function runCalibrate(argv: string[]): Promise<string> {
  if (argv[0] === "adjust") {
    return runAdjust(argv.slice(1));
  }
  return calibrate(calibrateOptions(splitFlags(argv)));
}

export async function runCaptureCommand(argv: string[]): Promise<string> {
  const flags = splitFlags(argv);
  const kind = flags.words[0];
  const out = flags.words[1];
  if ((kind !== "still" && kind !== "clip") || !out) {
    throw new CliError("Use: capture <still|clip> <out> [--seconds <n>].");
  }
  return runCapture({
    kind: kind as CaptureKind,
    out,
    seconds: optionalNumber(flags, "--seconds") ?? DEFAULT_CLIP_SECONDS,
    cal: flags.values.get("--cal"),
  });
}

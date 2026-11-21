import type { TargetModel } from "./estimators.ts";
import type { CropRect } from "./method.ts";
import { videoUsage } from "./video/cli-video.ts";

export type CliCommand = "reduce" | "estimate";
export type MethodName = "resize" | "crop" | "palette" | "mask" | "diff";

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export interface CliArgs {
  command: CliCommand;
  input: string;
  modelAlias: string;
  model: TargetModel;
  method: MethodName;
  rect?: CropRect;
  prev?: string;
  out?: string;
  json: boolean;
  scale?: number;
  maxSide?: number;
}

const MODEL_ALIAS: Record<string, TargetModel> = {
  claude: "claude-standard",
  "gpt-4o": "gpt-4o",
  "gpt-5.2": "gpt-5.2",
  gemini: "gemini-3",
};

const METHODS = new Set<MethodName>([
  "resize",
  "crop",
  "palette",
  "mask",
  "diff",
]);

export const FORMULA_SOURCE: Record<TargetModel, string> = {
  "claude-standard":
    "official Anthropic formula: resized_size() and 28 px patches",
  "claude-high-res":
    "official Anthropic formula: resized_size() and 28 px patches (high-res)",
  "gpt-4o": "official OpenAI tile formula: 85 + 170 × 512 px tiles",
  "gpt-4.1-mini":
    "official OpenAI patch formula: 32 px patches, 2048 px cap, 6144 patch budget, multiplier 1.62",
  "gpt-5.2":
    "official OpenAI patch formula: 32 px patches, 2048 px cap, 6144 patch budget, multiplier 1.2",
  "gemini-3":
    "official Gemini 3 media_resolution table (default high = 1120 tokens; pixel shrink does not change the count)",
};

export function usage(): string {
  return [
    "Usage:",
    "  image-token-saver reduce <in> --model <claude|gpt-4o|gpt-5.2|gemini> [--method resize|crop|palette|mask|diff] [--scale <0..1>] [--max-side <px>] [--rect x,y,w,h] [--prev <file>] --out <file> [--json]",
    "  image-token-saver estimate <in> --model <claude|gpt-4o|gpt-5.2|gemini> [--json]",
    videoUsage(),
    "  Default resize is 0.5 of the vendor's own target size. --scale is a fraction of the original size.",
  ].join("\n");
}

export function resolveModel(alias: string): TargetModel {
  const model = MODEL_ALIAS[alias];
  if (!model) {
    throw new CliError(
      `Unknown model "${alias}". Use claude, gpt-4o, gpt-5.2, or gemini.`,
    );
  }
  return model;
}

export function resolveMethod(name: string): MethodName {
  if (!METHODS.has(name as MethodName)) {
    throw new CliError(
      `Unknown method "${name}". Use resize, crop, palette, mask, or diff.`,
    );
  }
  return name as MethodName;
}

export function parseRect(value: string): CropRect {
  const parts = value.split(",");
  if (parts.length !== 4) {
    throw new CliError('The --rect value must be "x,y,w,h".');
  }
  const [x, y, width, height] = parts.map((part) => Number(part));
  if (![x, y, width, height].every(Number.isInteger)) {
    throw new CliError("Each --rect value must be an integer.");
  }
  return { x, y, width, height };
}

export function parseScale(value: string): number {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new CliError(
      "The --scale value must be greater than 0 and at most 1.",
    );
  }
  return scale;
}

export function parseMaxSide(value: string): number {
  const maxSide = Number(value);
  if (!Number.isInteger(maxSide) || maxSide < 1) {
    throw new CliError("The --max-side value must be a positive integer.");
  }
  return maxSide;
}

export function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    throw new CliError(`The flag ${flag} needs a value.`);
  }
  return value;
}

type PartialArgs = Partial<CliArgs> & { positionals: string[] };

function setModel(args: PartialArgs, value: string): void {
  args.modelAlias = value;
  args.model = resolveModel(value);
}

function setMethod(args: PartialArgs, value: string): void {
  args.method = resolveMethod(value);
}

function setRect(args: PartialArgs, value: string): void {
  args.rect = parseRect(value);
}

function setPrev(args: PartialArgs, value: string): void {
  args.prev = value;
}

function setOut(args: PartialArgs, value: string): void {
  args.out = value;
}

function setJson(args: PartialArgs): void {
  args.json = true;
}

function setScale(args: PartialArgs, value: string): void {
  args.scale = parseScale(value);
}

function setMaxSide(args: PartialArgs, value: string): void {
  args.maxSide = parseMaxSide(value);
}

const VALUE_FLAGS: Record<string, (args: PartialArgs, value: string) => void> =
  {
    "--model": setModel,
    "--method": setMethod,
    "--rect": setRect,
    "--prev": setPrev,
    "--out": setOut,
    "--scale": setScale,
    "--max-side": setMaxSide,
  };

function applyFlag(args: PartialArgs, tokens: string[], index: number): number {
  const flag = tokens[index];
  if (flag === "--json") {
    setJson(args);
    return index + 1;
  }
  const setter = VALUE_FLAGS[flag];
  if (!setter) {
    throw new CliError(`Unknown flag "${flag}".`);
  }
  setter(args, requireValue(flag, tokens[index + 1]));
  return index + 2;
}

function missingCommand(): never {
  throw new CliError("A command is required. Use reduce or estimate.");
}

function unknownCommand(name: string): never {
  throw new CliError(`Unknown command "${name}". Use reduce or estimate.`);
}

function readCommand(name?: string): CliCommand {
  if (name === "reduce" || name === "estimate") {
    return name;
  }
  if (!name) {
    missingCommand();
  }
  unknownCommand(name);
}

function requireInput(input?: string): string {
  if (!input) {
    throw new CliError("An input image path is required.");
  }
  return input;
}

function requireModelChoice(args: PartialArgs): {
  model: TargetModel;
  modelAlias: string;
} {
  if (!args.model || !args.modelAlias) {
    throw new CliError("The --model flag is required.");
  }
  return { model: args.model, modelAlias: args.modelAlias };
}

function finishArgs(args: PartialArgs): CliArgs {
  const modelChoice = requireModelChoice(args);
  return {
    command: readCommand(args.positionals[0]),
    input: requireInput(args.positionals[1]),
    modelAlias: modelChoice.modelAlias,
    model: modelChoice.model,
    method: args.method ?? "resize",
    rect: args.rect,
    prev: args.prev,
    out: args.out,
    json: Boolean(args.json),
    scale: args.scale,
    maxSide: args.maxSide,
  };
}

export function parseArgs(argv: string[]): CliArgs {
  const args: PartialArgs = { positionals: [] };
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
  return finishArgs(args);
}

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  FORMULA_SOURCE,
  CliError,
  type CliArgs,
  type MethodName,
} from "./cli-args.ts";
import { createFocusMaskMethod } from "./focus-mask.ts";
import { loadImageBytes, readImageInfo } from "./image-io.ts";
import type { MethodRequest, MethodResult } from "./method.ts";
import { cropMethod } from "./crop.ts";
import { diffMethod } from "./methods/diff.ts";
import { palette16Method } from "./methods/colour-depth.ts";
import { resizeMethod, unreducedTokens } from "./resize.ts";

export interface CliReport {
  formula: string;
  model: string;
  modelId: string;
  method: string;
  tokensBefore: number;
  tokensAfter: number;
  width?: number;
  height?: number;
  out?: string;
  text?: string;
}

function formatPlain(report: CliReport): string {
  const parts = [
    `formula=${report.formula}`,
    `model=${report.model}`,
    `method=${report.method}`,
    `tokens_before=${report.tokensBefore}`,
    `tokens_after=${report.tokensAfter}`,
  ];
  if (report.width !== undefined && report.height !== undefined) {
    parts.push(`size=${report.width}x${report.height}`);
  }
  if (report.out) {
    parts.push(`out=${report.out}`);
  }
  if (report.text) {
    parts.push(`text=${report.text}`);
  }
  return parts.join(" ");
}

function formatJson(report: CliReport): string {
  return JSON.stringify(report);
}

export function formatReport(report: CliReport, json: boolean): string {
  return json ? formatJson(report) : formatPlain(report);
}

function requireRect(
  args: CliArgs,
  method: MethodName,
): NonNullable<CliArgs["rect"]> {
  if (!args.rect) {
    throw new CliError(`The ${method} method needs --rect x,y,w,h.`);
  }
  return args.rect;
}

function requirePrev(args: CliArgs): string {
  if (!args.prev) {
    throw new CliError("The diff method needs --prev <file>.");
  }
  return args.prev;
}

function requireOut(args: CliArgs): string {
  if (!args.out) {
    throw new CliError("The reduce command needs --out <file>.");
  }
  return args.out;
}

async function unchangedResult(
  request: MethodRequest,
  method: string,
): Promise<MethodResult> {
  const info = await readImageInfo(request.image);
  const image = await loadImageBytes(request.image);
  return {
    method,
    image,
    width: info.width,
    height: info.height,
    estimatedTokens: unreducedTokens(info.width, info.height, request.model),
  };
}

async function applyResize(request: MethodRequest): Promise<MethodResult> {
  return (
    (await resizeMethod.apply(request)) ?? unchangedResult(request, "resize")
  );
}

async function applyCrop(request: MethodRequest): Promise<MethodResult> {
  const result = await cropMethod.apply(request);
  if (!result) {
    throw new CliError("The crop method needs --rect x,y,w,h.");
  }
  return result;
}

async function applyPalette(request: MethodRequest): Promise<MethodResult> {
  const result = await palette16Method.apply(request);
  if (!result) {
    throw new CliError("The palette method did not return an image.");
  }
  return result;
}

async function applyMask(request: MethodRequest): Promise<MethodResult> {
  const region = request.region;
  if (!region) {
    throw new CliError("The mask method needs --rect x,y,w,h.");
  }
  const method = createFocusMaskMethod({
    region: {
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height,
    },
    mode: "blur",
  });
  const result = await method.apply(request);
  if (!result) {
    throw new CliError("The mask method did not return an image.");
  }
  return result;
}

async function applyDiff(request: MethodRequest): Promise<MethodResult> {
  const result = await diffMethod.apply(request);
  if (!result) {
    throw new CliError(
      "The diff method needs --prev <file> with the same width and height as the input.",
    );
  }
  return result;
}

const APPLY: Record<
  MethodName,
  (request: MethodRequest) => Promise<MethodResult>
> = {
  resize: applyResize,
  crop: applyCrop,
  palette: applyPalette,
  mask: applyMask,
  diff: applyDiff,
};

async function writeOutput(path: string, image: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, image);
}

async function runEstimate(args: CliArgs): Promise<CliReport> {
  const info = await readImageInfo(args.input);
  const tokens = unreducedTokens(info.width, info.height, args.model);
  return {
    formula: FORMULA_SOURCE[args.model],
    model: args.modelAlias,
    modelId: args.model,
    method: "none",
    tokensBefore: tokens,
    tokensAfter: tokens,
    width: info.width,
    height: info.height,
  };
}

function assertRectIfNeeded(args: CliArgs): void {
  if (args.method === "crop" || args.method === "mask") {
    requireRect(args, args.method);
  }
}

function assertPrevIfNeeded(args: CliArgs): void {
  if (args.method === "diff") {
    requirePrev(args);
  }
}

function toReport(
  args: CliArgs,
  info: { width: number; height: number },
  tokensBefore: number,
  result: MethodResult,
  out: string,
): CliReport {
  const wroteImage = Boolean(result.image);
  return {
    formula: FORMULA_SOURCE[args.model],
    model: args.modelAlias,
    modelId: args.model,
    method: result.method,
    tokensBefore,
    tokensAfter: result.estimatedTokens,
    width: result.width ?? info.width,
    height: result.height ?? info.height,
    out: wroteImage ? out : undefined,
    text: result.text,
  };
}

async function runReduce(args: CliArgs): Promise<CliReport> {
  const out = requireOut(args);
  assertRectIfNeeded(args);
  assertPrevIfNeeded(args);
  const info = await readImageInfo(args.input);
  const tokensBefore = unreducedTokens(info.width, info.height, args.model);
  const request: MethodRequest = {
    image: args.input,
    model: args.model,
    region: args.rect,
    previous: args.prev,
  };
  const result = await APPLY[args.method](request);
  if (result.image) {
    await writeOutput(out, result.image);
  }
  return toReport(args, info, tokensBefore, result, out);
}

export async function runCli(args: CliArgs): Promise<string> {
  const report =
    args.command === "estimate"
      ? await runEstimate(args)
      : await runReduce(args);
  return formatReport(report, args.json);
}

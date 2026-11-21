import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
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
import { estimateTokens } from "./estimators.ts";
import type { TargetModel } from "./estimators.ts";
import { requestedResizeSize } from "./resize.ts";

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
  saved: string;
  note?: string;
}

function savedField(before: number, after: number): string {
  const tokens = before - after;
  const percent = before === 0 ? 0 : Math.round((tokens / before) * 100);
  return `${tokens} (${percent}%)`;
}

function formulaNote(model: TargetModel): string | undefined {
  if (model === "gpt-4o") {
    return "GPT-4o tokens follow 512 px tiles; a shrink does not always change the count";
  }
  if (model === "gemini-3") {
    return "Gemini 3 media_resolution does not change with pixel size";
  }
  return undefined;
}

function optionalField(name: string, value: string | undefined): string[] {
  return value ? [`${name}=${value}`] : [];
}

function formatPlain(report: CliReport): string {
  const size =
    report.width !== undefined && report.height !== undefined
      ? `${report.width}x${report.height}`
      : undefined;
  return [
    `formula=${report.formula}`,
    `model=${report.model}`,
    `method=${report.method}`,
    `tokens_before=${report.tokensBefore}`,
    `tokens_after=${report.tokensAfter}`,
    `saved=${report.saved}`,
    ...optionalField("size", size),
    ...optionalField("out", report.out),
    ...optionalField("text", report.text),
    ...optionalField("note", report.note),
  ].join(" ");
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

async function applyResize(
  request: MethodRequest,
  args: CliArgs,
): Promise<MethodResult> {
  const info = await readImageInfo(request.image);
  const target = requestedResizeSize(info.width, info.height, request.model, {
    scale: args.scale,
    maxSide: args.maxSide,
  });
  const bytes = await loadImageBytes(request.image);
  const image = await sharp(bytes)
    .resize(target.width, target.height, { fit: "fill" })
    .png()
    .toBuffer();
  return {
    method: "resize",
    image,
    width: target.width,
    height: target.height,
    estimatedTokens: estimateTokens(target.width, target.height, request.model),
  };
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

async function applyNamed(
  args: CliArgs,
  request: MethodRequest,
): Promise<MethodResult> {
  if (args.method === "resize") {
    return applyResize(request, args);
  }
  if (args.method === "crop") {
    return applyCrop(request);
  }
  if (args.method === "palette") {
    return applyPalette(request);
  }
  if (args.method === "mask") {
    return applyMask(request);
  }
  return applyDiff(request);
}

async function writeOutput(path: string, image: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, image);
}

function baseReport(
  args: CliArgs,
  method: string,
  tokensBefore: number,
  tokensAfter: number,
  size: { width: number; height: number },
): Omit<CliReport, "out" | "text"> {
  return {
    formula: FORMULA_SOURCE[args.model],
    model: args.modelAlias,
    modelId: args.model,
    method,
    tokensBefore,
    tokensAfter,
    width: size.width,
    height: size.height,
    saved: savedField(tokensBefore, tokensAfter),
    note: formulaNote(args.model),
  };
}

async function runEstimate(args: CliArgs): Promise<CliReport> {
  const info = await readImageInfo(args.input);
  const tokens = estimateTokens(info.width, info.height, args.model);
  return baseReport(args, "none", tokens, tokens, info);
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
  const report = baseReport(
    args,
    result.method,
    tokensBefore,
    result.estimatedTokens,
    { width: result.width ?? info.width, height: result.height ?? info.height },
  );
  return {
    ...report,
    out: result.image ? out : undefined,
    text: result.text,
  };
}

async function runReduce(args: CliArgs): Promise<CliReport> {
  const out = requireOut(args);
  assertRectIfNeeded(args);
  assertPrevIfNeeded(args);
  const info = await readImageInfo(args.input);
  const tokensBefore = estimateTokens(info.width, info.height, args.model);
  const request: MethodRequest = {
    image: args.input,
    model: args.model,
    region: args.rect,
    previous: args.prev,
  };
  const result = await applyNamed(args, request);
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

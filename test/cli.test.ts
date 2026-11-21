import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { CliError, parseArgs } from "../src/cli-args.ts";
import { syntheticImage } from "./synthetic.ts";

async function spawnCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/cli.ts", ...args], {
      cwd: process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function writePng(
  dir: string,
  name: string,
  width: number,
  height: number,
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, await syntheticImage(width, height, 3));
  return path;
}

test("parseArgs reads reduce flags", () => {
  const args = parseArgs([
    "reduce",
    "in.png",
    "--model",
    "claude",
    "--method",
    "crop",
    "--rect",
    "1,2,3,4",
    "--out",
    "out.png",
  ]);
  assert.equal(args.command, "reduce");
  assert.equal(args.model, "claude-standard");
  assert.equal(args.method, "crop");
  assert.deepEqual(args.rect, { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(args.out, "out.png");
  assert.equal(args.json, false);
});

test("parseArgs rejects an unknown model", () => {
  assert.throws(
    () => parseArgs(["estimate", "in.png", "--model", "other"]),
    CliError,
  );
});

test("parseArgs rejects a missing or unknown command", () => {
  assert.throws(() => parseArgs(["--model", "claude"]), CliError);
  assert.throws(
    () => parseArgs(["serve", "in.png", "--model", "claude"]),
    CliError,
  );
});

test("parseArgs reads --scale and --max-side", () => {
  const args = parseArgs([
    "reduce",
    "in.png",
    "--model",
    "claude",
    "--scale",
    "0.5",
    "--max-side",
    "800",
    "--out",
    "out.png",
  ]);
  assert.equal(args.scale, 0.5);
  assert.equal(args.maxSide, 800);
  assert.throws(
    () =>
      parseArgs([
        "reduce",
        "in.png",
        "--model",
        "claude",
        "--scale",
        "0",
        "--out",
        "out.png",
      ]),
    CliError,
  );
});

test("estimate prints official formula tokens for Claude", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 1872, 1404);
  const result = await spawnCli(["estimate", input, "--model", "claude"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /formula=official Anthropic formula/);
  assert.match(result.stdout, /model=claude/);
  assert.match(result.stdout, /method=none/);
  assert.match(result.stdout, /tokens_before=1564/);
  assert.match(result.stdout, /tokens_after=1564/);
  assert.match(result.stdout, /saved=0 \(0%\)/);
  assert.match(result.stdout, /size=1872x1404/);
});

test("estimate --json names the formula and the counts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 1872, 1404);
  const result = await spawnCli([
    "estimate",
    input,
    "--model",
    "gpt-4o",
    "--json",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.match(String(body.formula), /official OpenAI tile formula/);
  assert.equal(body.model, "gpt-4o");
  assert.equal(body.modelId, "gpt-4o");
  assert.equal(body.tokensBefore, 765);
  assert.equal(body.tokensAfter, 765);
  assert.equal(body.saved, "0 (0%)");
  assert.match(String(body.note), /512 px tiles/);
});

test("estimate reports the official GPT-5.2 charge for 1872x1404", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 1872, 1404);
  const result = await spawnCli(["estimate", input, "--model", "gpt-5.2"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /tokens_before=3116/);
  assert.match(result.stdout, /tokens_after=3116/);
});

test("default resize is half of the vendor target size", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 1872, 1404);
  const claudeOut = join(dir, "claude.png");
  const claude = await spawnCli([
    "reduce",
    input,
    "--model",
    "claude",
    "--out",
    claudeOut,
  ]);
  assert.equal(claude.code, 0, claude.stderr);
  assert.match(claude.stdout, /tokens_before=1564/);
  assert.match(claude.stdout, /tokens_after=391/);
  assert.match(claude.stdout, /saved=1173 \(75%\)/);
  assert.match(claude.stdout, /method=resize/);
  assert.match(claude.stdout, /size=635x476/);
  const claudeMeta = await sharp(claudeOut).metadata();
  assert.deepEqual([claudeMeta.width, claudeMeta.height], [635, 476]);
  const gptOut = join(dir, "gpt.png");
  const gpt = await spawnCli([
    "reduce",
    input,
    "--model",
    "gpt-5.2",
    "--out",
    gptOut,
  ]);
  assert.equal(gpt.code, 0, gpt.stderr);
  assert.match(gpt.stdout, /tokens_before=3116/);
  assert.match(gpt.stdout, /tokens_after=792/);
  assert.match(gpt.stdout, /size=936x702/);
});

test("reduce --scale 0.5 matches the 936x702 baseline counts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 1872, 1404);
  const claude = await spawnCli([
    "reduce",
    input,
    "--model",
    "claude",
    "--scale",
    "0.5",
    "--out",
    join(dir, "claude.png"),
  ]);
  assert.equal(claude.code, 0, claude.stderr);
  assert.match(claude.stdout, /tokens_before=1564/);
  assert.match(claude.stdout, /tokens_after=884/);
  assert.match(claude.stdout, /size=936x702/);
  const gpt = await spawnCli([
    "reduce",
    input,
    "--model",
    "gpt-5.2",
    "--scale",
    "0.5",
    "--out",
    join(dir, "gpt.png"),
  ]);
  assert.equal(gpt.code, 0, gpt.stderr);
  assert.match(gpt.stdout, /tokens_before=3116/);
  assert.match(gpt.stdout, /tokens_after=792/);
  assert.match(gpt.stdout, /size=936x702/);
});

test("reduce --method crop needs --rect and writes the rectangle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 200, 100);
  const out = join(dir, "crop.png");
  const missing = await spawnCli([
    "reduce",
    input,
    "--model",
    "claude",
    "--method",
    "crop",
    "--out",
    out,
  ]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /needs --rect/);
  const result = await spawnCli([
    "reduce",
    input,
    "--model",
    "claude",
    "--method",
    "crop",
    "--rect",
    "10,10,40,20",
    "--out",
    out,
  ]);
  assert.equal(result.code, 0, result.stderr);
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [40, 20]);
  assert.match(result.stdout, /method=crop/);
});

test("reduce --method palette writes an image", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 64, 48);
  const out = join(dir, "palette.png");
  const result = await spawnCli([
    "reduce",
    input,
    "--model",
    "gemini",
    "--method",
    "palette",
    "--out",
    out,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /formula=official Gemini 3/);
  assert.match(result.stdout, /tokens_before=1120/);
  assert.match(result.stdout, /tokens_after=1120/);
  assert.match(result.stdout, /method=palette-16/);
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 64);
});

test("reduce --method mask needs --rect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 80, 80);
  const out = join(dir, "mask.png");
  const missing = await spawnCli([
    "reduce",
    input,
    "--model",
    "claude",
    "--method",
    "mask",
    "--out",
    out,
  ]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /needs --rect/);
  const result = await spawnCli([
    "reduce",
    input,
    "--model",
    "claude",
    "--method",
    "mask",
    "--rect",
    "8,8,20,20",
    "--out",
    out,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /method=focus-mask/);
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [80, 80]);
});

test("reduce --method diff needs --prev and can report no change", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 32, 32);
  const out = join(dir, "diff.png");
  const missing = await spawnCli([
    "reduce",
    input,
    "--model",
    "gpt-5.2",
    "--method",
    "diff",
    "--out",
    out,
  ]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /needs --prev/);
  const result = await spawnCli([
    "reduce",
    input,
    "--model",
    "gpt-5.2",
    "--method",
    "diff",
    "--prev",
    input,
    "--out",
    out,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /formula=official OpenAI patch formula/);
  assert.match(result.stdout, /No change from the previous frame/);
  assert.match(result.stdout, /tokens_after=0/);
});

test("reduce without --out fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-cli-"));
  const input = await writePng(dir, "in.png", 16, 16);
  const result = await spawnCli(["reduce", input, "--model", "claude"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /needs --out/);
});

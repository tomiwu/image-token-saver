import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CliError, parseArgs, parseMaxSide } from "../src/cli-args.ts";
import {
  capMaxSide,
  requestedResizeSize,
  resizeMethod,
  unreducedTokens,
} from "../src/resize.ts";
import { syntheticImage } from "./synthetic.ts";

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

test("unreducedTokens is the raw Claude patch count", () => {
  assert.equal(unreducedTokens(1872, 1404, "claude-standard"), 3417);
  assert.equal(unreducedTokens(1872, 1404, "gpt-5.2"), 3116);
});

test("resizeMethod.apply writes the vendor target for Claude", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-resize-"));
  const input = await writePng(dir, "in.png", 1872, 1404);
  const result = await resizeMethod.apply({
    image: input,
    model: "claude-standard",
  });
  assert.ok(result);
  assert.deepEqual([result.width, result.height], [1270, 952]);
  assert.equal(result.estimatedTokens, 1564);
});

test("resizeMethod.apply skips when the vendor size is already the original", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-resize-"));
  const input = await writePng(dir, "in.png", 1872, 1404);
  const result = await resizeMethod.apply({ image: input, model: "gpt-5.2" });
  assert.equal(result, undefined);
});

test("requestedResizeSize default is half of the vendor target", () => {
  assert.deepEqual(requestedResizeSize(1872, 1404, "claude-standard"), {
    width: 635,
    height: 476,
  });
  assert.deepEqual(requestedResizeSize(1872, 1404, "gpt-5.2", { scale: 0.5 }), {
    width: 936,
    height: 702,
  });
});

test("requestedResizeSize applies --scale then --max-side", () => {
  assert.deepEqual(
    requestedResizeSize(1872, 1404, "gpt-5.2", { scale: 0.5, maxSide: 800 }),
    { width: 800, height: 600 },
  );
  assert.deepEqual(capMaxSide(936, 702, 1000), { width: 936, height: 702 });
});

test("parseMaxSide rejects a non-integer", () => {
  assert.throws(() => parseMaxSide("1.5"), CliError);
  assert.throws(
    () =>
      parseArgs([
        "reduce",
        "in.png",
        "--model",
        "claude",
        "--max-side",
        "0",
        "--out",
        "out.png",
      ]),
    CliError,
  );
});

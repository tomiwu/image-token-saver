import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claudeResizedSize,
  estimateClaude,
  estimateGeminiTokens,
  estimateGpt4oTiles,
  estimateGptPatch,
  estimateTokens,
} from "../src/estimators.ts";
import { readImageInfo } from "../src/image-io.ts";
import { syntheticImage } from "./synthetic.ts";

test("Claude 1872x1404", () => {
  assert.equal(estimateClaude(1872, 1404, "raw").tokens, 3417);
  const std = estimateClaude(1872, 1404, "standard");
  assert.deepEqual([std.width, std.height, std.tokens], [1270, 952, 1564]);
  const hi = estimateClaude(1872, 1404, "high-res");
  assert.deepEqual([hi.width, hi.height, hi.tokens], [1872, 1404, 3417]);
});

test("Claude 936x702", () => {
  assert.equal(estimateClaude(936, 702, "standard").tokens, 884);
});

test("Claude resize never exceeds limits", () => {
  const size = claudeResizedSize(4032, 3024, 1568, 1568);
  assert.ok(size.width <= 1568 && size.height <= 1568);
  assert.ok(Math.ceil(size.width / 28) * Math.ceil(size.height / 28) <= 1568);
});

test("GPT-4o tiles", () => {
  const high = estimateGpt4oTiles(1872, 1404, "high");
  assert.deepEqual(
    [high.width, high.height, high.tiles, high.tokens],
    [1024, 768, 4, 765],
  );
  assert.equal(estimateGpt4oTiles(1872, 1404, "low").tokens, 85);
  assert.equal(estimateGpt4oTiles(936, 702, "high").tokens, 765);
});

test("GPT patch", () => {
  const mini = estimateGptPatch(1872, 1404, "gpt-4.1-mini");
  assert.deepEqual([mini.patches, mini.tokens], [2596, 4206]);
  assert.equal(estimateGptPatch(1872, 1404, "gpt-5.2").tokens, 3116);
  assert.equal(estimateGptPatch(936, 702, "gpt-4.1-mini").tokens, 1070);
  assert.equal(estimateGptPatch(936, 702, "gpt-5.2").tokens, 792);
});

test("GPT patch respects the 2048 px limit and the budget", () => {
  const big = estimateGptPatch(4032, 3024, "gpt-5.2");
  assert.deepEqual([big.width, big.height, big.patches], [2048, 1536, 3072]);
  const huge = estimateGptPatch(20000, 20000, "gpt-5.2");
  assert.ok(huge.patches <= 6144);
});

test("Gemini 3 media_resolution", () => {
  assert.equal(estimateGeminiTokens("low"), 280);
  assert.equal(estimateGeminiTokens("medium"), 560);
  assert.equal(estimateGeminiTokens("high"), 1120);
  assert.equal(estimateGeminiTokens("ultra_high"), 2240);
  assert.equal(estimateGeminiTokens(), 1120);
});

test("dispatch by model name", () => {
  assert.equal(estimateTokens(1872, 1404, "claude-standard"), 1564);
  assert.equal(estimateTokens(1872, 1404, "claude-high-res"), 3417);
  assert.equal(estimateTokens(1872, 1404, "gpt-4o"), 765);
  assert.equal(estimateTokens(1872, 1404, "gpt-4.1-mini"), 4206);
  assert.equal(estimateTokens(1872, 1404, "gpt-5.2"), 3116);
  assert.equal(estimateTokens(1872, 1404, "gemini-3"), 1120);
});

test("official formulas for the other fixture sizes", () => {
  assert.equal(estimateClaude(1280, 800, "raw").tokens, 46 * 29);
  assert.equal(estimateClaude(1920, 1080, "raw").tokens, 69 * 39);
  assert.equal(estimateClaude(4032, 3024, "raw").tokens, 144 * 108);
  assert.equal(estimateGpt4oTiles(1280, 800, "high").tokens, 85 + 170 * 6);
  assert.equal(estimateGpt4oTiles(1920, 1080, "high").tokens, 85 + 170 * 6);
  assert.equal(estimateGpt4oTiles(4032, 3024, "high").tokens, 765);
});

test("colour depth does not change estimates", async () => {
  const rgb = await readImageInfo(await syntheticImage(1872, 1404, 3));
  const grey = await readImageInfo(await syntheticImage(1872, 1404, 1));
  assert.deepEqual([rgb.width, rgb.height], [1872, 1404]);
  assert.deepEqual([grey.width, grey.height], [1872, 1404]);
  for (const model of [
    "claude-standard",
    "gpt-4o",
    "gpt-5.2",
    "gemini-3",
  ] as const) {
    assert.equal(
      estimateTokens(rgb.width, rgb.height, model),
      estimateTokens(grey.width, grey.height, model),
    );
  }
});

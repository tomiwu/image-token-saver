import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { estimateTokens } from "../src/estimators.ts";
import { diffMethod } from "../src/methods/diff.ts";
import { syntheticImage } from "./synthetic.ts";

async function withChangedRect(
  base: Buffer,
  rect: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  const patch = await sharp({
    create: {
      width: rect.width,
      height: rect.height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
  const out = await sharp(base)
    .composite([{ input: patch, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
  const baseMeta = await sharp(base).metadata();
  const outMeta = await sharp(out).metadata();
  assert.equal(outMeta.width, baseMeta.width);
  assert.equal(outMeta.height, baseMeta.height);
  return out;
}

test("diff skips when no previous frame is present", async () => {
  const image = await syntheticImage(200, 100, 3);
  const result = await diffMethod.apply({ image, model: "claude-standard" });
  assert.equal(result, undefined);
});

test("diff skips when the frame sizes differ", async () => {
  const image = await syntheticImage(200, 100, 3);
  const previous = await syntheticImage(100, 100, 3);
  const result = await diffMethod.apply({
    image,
    previous,
    model: "claude-standard",
  });
  assert.equal(result, undefined);
});

test("diff returns short text for identical frames", async () => {
  const image = await syntheticImage(200, 100, 3);
  const result = await diffMethod.apply({
    image,
    previous: image,
    model: "claude-standard",
  });
  assert.ok(result);
  assert.equal(result.method, "diff");
  assert.equal(result.image, undefined);
  assert.match(result.text ?? "", /no change/i);
  assert.equal(result.estimatedTokens, 0);
});

test("diff returns the changed rectangle", async () => {
  const previous = await syntheticImage(300, 200, 3);
  const rect = { left: 40, top: 70, width: 60, height: 30 };
  const image = await withChangedRect(previous, rect);
  const result = await diffMethod.apply({
    image,
    previous,
    model: "claude-standard",
  });
  assert.ok(result?.image);
  assert.equal(result.width, rect.width);
  assert.equal(result.height, rect.height);
  assert.match(result.text ?? "", /left=40/);
  assert.match(result.text ?? "", /top=70/);
  assert.equal(
    result.estimatedTokens,
    estimateTokens(rect.width, rect.height, "claude-standard"),
  );
  const cropped = await sharp(result.image).metadata();
  assert.equal(cropped.width, rect.width);
  assert.equal(cropped.height, rect.height);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { cropMethod, cropRegion, CropError } from "../src/crop.ts";
import { estimateTokens } from "../src/estimators.ts";
import { syntheticImage } from "./synthetic.ts";

async function rawPixels(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes).raw().toBuffer();
}

test("crop returns the requested rectangle", async () => {
  const image = await syntheticImage(200, 120, 3);
  const rect = { x: 30, y: 20, width: 64, height: 40 };
  const result = await cropRegion(image, rect, "claude-standard");
  assert.equal(result.width, 64);
  assert.equal(result.height, 40);
  const expected = await sharp(image)
    .extract({
      left: 30,
      top: 20,
      width: 64,
      height: 40,
    })
    .raw()
    .toBuffer();
  assert.deepEqual(await rawPixels(result.image), expected);
});

test("token estimate uses the cropped size", async () => {
  const image = await syntheticImage(400, 300, 3);
  const result = await cropRegion(
    image,
    { x: 0, y: 0, width: 100, height: 56 },
    "claude-standard",
  );
  assert.equal(
    result.estimatedTokens,
    estimateTokens(100, 56, "claude-standard"),
  );
});

test("invalid rectangles fail with CropError", async () => {
  const image = await syntheticImage(50, 50, 3);
  const bad = [
    { x: -1, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 0, y: 0, width: 10, height: 2.5 },
    { x: 45, y: 0, width: 10, height: 10 },
    { x: 0, y: 40, width: 10, height: 11 },
    { x: Number.NaN, y: 0, width: 10, height: 10 },
  ];
  for (const rect of bad) {
    await assert.rejects(cropRegion(image, rect, "gpt-4o"), CropError);
  }
});

test("crop method returns undefined without a region", async () => {
  const image = await syntheticImage(50, 50, 3);
  assert.equal(await cropMethod.apply({ image, model: "gpt-4o" }), undefined);
});

test("crop method reports a clear error for a bad region", async () => {
  const image = await syntheticImage(50, 50, 3);
  await assert.rejects(
    cropMethod.apply({
      image,
      model: "gpt-4o",
      region: { x: 0, y: 0, width: 99, height: 5 },
    }),
    /outside the image/,
  );
});

test("crop method returns a typed result", async () => {
  const image = await syntheticImage(80, 80, 3);
  const result = await cropMethod.apply({
    image,
    model: "gpt-4o",
    region: { x: 10, y: 10, width: 20, height: 30 },
  });
  assert.equal(result?.method, "crop");
  assert.equal(result?.width, 20);
  assert.equal(result?.height, 30);
  assert.equal(result?.estimatedTokens, estimateTokens(20, 30, "gpt-4o"));
});

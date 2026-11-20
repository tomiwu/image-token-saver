import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { estimateTokens, type TargetModel } from "../src/estimators.ts";
import { readImageInfo } from "../src/image-io.ts";
import {
  greyscaleMethod,
  palette16Method,
} from "../src/methods/colour-depth.ts";
import { syntheticImage } from "./synthetic.ts";

const models: TargetModel[] = [
  "claude-standard",
  "claude-high-res",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-5.2",
  "gemini-3",
];

for (const method of [greyscaleMethod, palette16Method]) {
  test(`${method.name} keeps size and tokens, and runs the encoder`, async () => {
    const input = await syntheticImage(1280, 800, 3);
    for (const model of models) {
      const result = await method.apply({ image: input, model });
      assert.ok(result?.image);
      assert.equal(result.method, method.name);
      assert.equal(result.width, 1280);
      assert.equal(result.height, 800);
      const info = await readImageInfo(result.image);
      assert.deepEqual([info.width, info.height], [1280, 800]);
      assert.equal(result.estimatedTokens, estimateTokens(1280, 800, model));
    }
  });

  test(`${method.name} can change bytes`, async () => {
    const input = await syntheticImage(1280, 800, 3);
    const result = await method.apply({ image: input, model: "gpt-4o" });
    assert.ok(result?.image);
    assert.notDeepEqual(Buffer.from(result.image), input);
  });
}

test("greyscale output has one channel", async () => {
  const input = await syntheticImage(64, 64, 3);
  const result = await greyscaleMethod.apply({ image: input, model: "gpt-4o" });
  assert.ok(result?.image);
  const meta = await sharp(result.image).metadata();
  assert.equal(meta.channels, 1);
});

test("palette output has at most 16 colours and 4-bit depth", async () => {
  const input = await syntheticImage(64, 64, 3);
  const result = await palette16Method.apply({
    image: input,
    model: "gpt-4o",
  });
  assert.ok(result?.image);
  const meta = await sharp(result.image).metadata();
  assert.equal(meta.isPalette, true);
  assert.equal(meta.bitsPerSample, 4);
  const { data } = await sharp(result.image)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colours = new Set<string>();
  for (let i = 0; i < data.length; i += 3) {
    colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  assert.ok(colours.size <= 16);
});

for (const method of [greyscaleMethod, palette16Method]) {
  test(`${method.name} output is deterministic`, async () => {
    const input = await syntheticImage(64, 64, 3);
    const a = await method.apply({ image: input, model: "gpt-4o" });
    const b = await method.apply({ image: input, model: "gpt-4o" });
    assert.deepEqual(a?.image, b?.image);
  });
}

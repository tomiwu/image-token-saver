import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { estimateTokens } from "../src/estimators.ts";
import { createFocusMaskMethod } from "../src/focus-mask.ts";
import { readImageInfo } from "../src/image-io.ts";

const WIDTH = 320;
const HEIGHT = 200;
const REGION = { left: 80, top: 50, width: 120, height: 80 };

async function stripedImage(): Promise<Buffer> {
  const data = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const value = (x + y) % 2 === 0 ? 255 : 0;
      data.fill(value, (y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3);
    }
  }
  return sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png()
    .toBuffer();
}

async function pixels(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes).removeAlpha().raw().toBuffer();
}

function regionBytes(raw: Buffer): Buffer {
  const rows: Buffer[] = [];
  for (let y = REGION.top; y < REGION.top + REGION.height; y++) {
    const start = (y * WIDTH + REGION.left) * 3;
    rows.push(raw.subarray(start, start + REGION.width * 3));
  }
  return Buffer.concat(rows);
}

for (const mode of ["blur", "downsample"] as const) {
  test(`${mode}: keeps size, keeps the sharp region, softens the rest`, async () => {
    const source = await stripedImage();
    const method = createFocusMaskMethod({ region: REGION, mode });
    const result = await method.apply({
      image: source,
      model: "claude-standard",
    });
    assert.ok(result?.image);
    const info = await readImageInfo(result.image);
    assert.deepEqual([info.width, info.height], [WIDTH, HEIGHT]);
    assert.deepEqual([result.width, result.height], [WIDTH, HEIGHT]);

    const before = await pixels(source);
    const after = await pixels(result.image);
    assert.ok(regionBytes(before).equals(regionBytes(after)));

    const cornerBefore = before.subarray(0, 3 * 20);
    const cornerAfter = after.subarray(0, 3 * 20);
    assert.ok(!cornerBefore.equals(cornerAfter));
  });
}

test("formula tokens stay the same when the method is used alone", async () => {
  const source = await stripedImage();
  const method = createFocusMaskMethod({ region: REGION, mode: "blur" });
  for (const model of ["claude-standard", "gpt-4o", "gemini-3"] as const) {
    const result = await method.apply({ image: source, model });
    assert.equal(result?.estimatedTokens, estimateTokens(WIDTH, HEIGHT, model));
  }
});

test("an optional resize cuts the size and the tokens", async () => {
  const source = await stripedImage();
  const method = createFocusMaskMethod({
    region: REGION,
    mode: "blur",
    resizeTo: { width: 160, height: 100 },
  });
  const result = await method.apply({
    image: source,
    model: "claude-standard",
  });
  assert.deepEqual([result?.width, result?.height], [160, 100]);
  assert.equal(
    result?.estimatedTokens,
    estimateTokens(160, 100, "claude-standard"),
  );
});

test("a region outside the image is an error", async () => {
  const source = await stripedImage();
  const method = createFocusMaskMethod({
    region: { left: 300, top: 0, width: 100, height: 10 },
    mode: "blur",
  });
  await assert.rejects(method.apply({ image: source, model: "gpt-4o" }));
});

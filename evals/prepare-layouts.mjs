#!/usr/bin/env node
/**
 * Renders the three synthetic eval layouts into $EVALS_IMAGE_DIR/layouts.
 * The images are deterministic. They stay out of git with the other
 * eval images.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { LAYOUTS } from "./lib/layouts.mjs";

const imageDir = process.env.EVALS_IMAGE_DIR;
if (!imageDir) {
  console.error("EVALS_IMAGE_DIR is not set");
  process.exit(1);
}
const outDir = join(imageDir, "layouts");
await mkdir(outDir, { recursive: true });
for (const [name, render] of Object.entries(LAYOUTS)) {
  const path = join(outDir, `${name}.png`);
  await sharp(Buffer.from(render())).png().toFile(path);
  console.log(`evals: wrote ${path}`);
}

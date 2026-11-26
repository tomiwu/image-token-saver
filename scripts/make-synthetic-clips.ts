import { resolve } from "node:path";
import { generateAll } from "../src/video/synthetic.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: node scripts/make-synthetic-clips.ts <out-dir>");
  process.exit(1);
}
const clips = await generateAll(resolve(outDir));
for (const clip of clips) {
  console.log(`${clip.name}: ${clip.video} ${clip.truthPath}`);
}

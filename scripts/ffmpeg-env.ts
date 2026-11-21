import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

export const ffmpegBinDir = dirname(require("ffmpeg-static") as string);

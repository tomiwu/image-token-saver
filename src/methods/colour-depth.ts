import { estimateTokens } from "../estimators.ts";
import { loadImageBytes } from "../image-io.ts";
import type {
  MethodRequest,
  MethodResult,
  ReductionMethod,
} from "../method.ts";
import sharp, { type Sharp } from "sharp";

type Encoder = (pipeline: Sharp) => Sharp;

function colourDepthMethod(name: string, encode: Encoder): ReductionMethod {
  return {
    name,
    async apply(request: MethodRequest): Promise<MethodResult> {
      const bytes = await loadImageBytes(request.image);
      const { data, info } = await encode(sharp(bytes)).toBuffer({
        resolveWithObject: true,
      });
      return {
        method: name,
        image: data,
        width: info.width,
        height: info.height,
        estimatedTokens: estimateTokens(info.width, info.height, request.model),
      };
    },
  };
}

export const greyscaleMethod = colourDepthMethod("greyscale", (pipeline) =>
  pipeline.greyscale().toColourspace("b-w").png({ compressionLevel: 9 }),
);

export const palette16Method = colourDepthMethod("palette-16", (pipeline) =>
  pipeline.png({
    palette: true,
    colours: 16,
    compressionLevel: 9,
    effort: 10,
  }),
);

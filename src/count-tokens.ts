import sharp from "sharp";
import { estimateClaude, type ClaudeMode } from "./estimators.ts";
import { loadImageBytes, readImageInfo, type ImageInput } from "./image-io.ts";

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

export interface CountTokensOptions {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
}

export interface ClaudeComparison {
  estimate: number;
  counted: number;
  difference: number;
}

const ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";
const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function liveCountEnabled(
  env: Record<string, string | undefined>,
): boolean {
  return (
    Boolean(env.ANTHROPIC_API_KEY) &&
    env.IMAGE_TOKEN_SAVER_LIVE === "1" &&
    !env.CI
  );
}

export async function countClaudeTokens(
  image: ImageInput,
  options: CountTokensOptions,
): Promise<number> {
  const bytes = await loadImageBytes(image);
  const format = (await sharp(bytes).metadata()).format ?? "";
  const mediaType = MEDIA_TYPES[format];
  if (!mediaType) {
    throw new Error(`The image format "${format}" is not supported.`);
  }
  const send = options.fetch ?? (fetch as FetchLike);
  const response = await send(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": options.apiKey,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: Buffer.from(bytes).toString("base64"),
              },
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`count_tokens failed with HTTP status ${response.status}.`);
  }
  const data = (await response.json()) as { input_tokens?: unknown };
  if (typeof data.input_tokens !== "number") {
    throw new Error("count_tokens returned no input_tokens value.");
  }
  return data.input_tokens;
}

export async function compareClaudeEstimate(
  image: ImageInput,
  options: CountTokensOptions,
  mode: ClaudeMode = "standard",
): Promise<ClaudeComparison> {
  const { width, height } = await readImageInfo(image);
  const estimate = estimateClaude(width, height, mode).tokens;
  const counted = await countClaudeTokens(image, options);
  return { estimate, counted, difference: counted - estimate };
}

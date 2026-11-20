import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { estimateTokens } from "./estimators.ts";
import { readImageInfo } from "./image-io.ts";
import { resizeMethod, unreducedTokens } from "./resize.ts";

const MODELS = [
  "claude-standard",
  "claude-high-res",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-5.2",
  "gemini-3",
] as const;

const inputShape = {
  image: z
    .string()
    .describe("Base64 image bytes, or an absolute path to an image file."),
  model: z.enum(MODELS).describe("The target vision model."),
};

function decodeImage(value: string): string | Uint8Array {
  return value.startsWith("/") ? value : Buffer.from(value, "base64");
}

function json(value: unknown): { type: "text"; text: string } {
  return { type: "text", text: JSON.stringify(value) };
}

function failure(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "image-token-saver", version: "0.1.0" });

  server.registerTool(
    "estimate_tokens",
    {
      description:
        "Estimate the input tokens of an image for a target model. Uses official formulas only.",
      inputSchema: inputShape,
    },
    async ({ image, model }): Promise<CallToolResult> => {
      try {
        const info = await readImageInfo(decodeImage(image));
        const tokens = estimateTokens(info.width, info.height, model);
        return {
          content: [
            json({ model, width: info.width, height: info.height, tokens }),
          ],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "reduce_image",
    {
      description:
        "Reduce an image for a target model. Returns the reduced image and the token estimates before and after.",
      inputSchema: inputShape,
    },
    async ({ image, model }): Promise<CallToolResult> => {
      try {
        const input = decodeImage(image);
        const info = await readImageInfo(input);
        const tokensBefore = unreducedTokens(info.width, info.height, model);
        const result = await resizeMethod.apply({ image: input, model });
        const summary = {
          model,
          method: result?.method ?? "none",
          tokensBefore,
          tokensAfter: result?.estimatedTokens ?? tokensBefore,
          width: result?.width ?? info.width,
          height: result?.height ?? info.height,
        };
        if (!result?.image) {
          return { content: [json(summary)] };
        }
        return {
          content: [
            {
              type: "image",
              data: Buffer.from(result.image).toString("base64"),
              mimeType: "image/png",
            },
            json(summary),
          ],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

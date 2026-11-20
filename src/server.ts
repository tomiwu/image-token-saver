import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { estimateTokens, type TargetModel } from "./estimators.ts";
import { readImageInfo, type ImageInput } from "./image-io.ts";
import type { MethodResult } from "./method.ts";
import { resizeMethod, unreducedTokens } from "./resize.ts";

const MODELS = [
  "claude-standard",
  "claude-high-res",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-5.2",
  "gemini-3",
] as const satisfies readonly TargetModel[];

const toolInputSchema = {
  image: z
    .string()
    .describe("Base64 image bytes, or an absolute path to an image file."),
  model: z.enum(MODELS).describe("The target vision model."),
};

function decodeImage(value: string): ImageInput {
  return value.startsWith("/") ? value : Buffer.from(value, "base64");
}

function json(value: unknown): { type: "text"; text: string } {
  return { type: "text", text: JSON.stringify(value) };
}

function failure(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

function reduceSummary(
  model: TargetModel,
  info: { width: number; height: number },
  tokensBefore: number,
  result: MethodResult | undefined,
) {
  if (!result) {
    return {
      model,
      method: "none",
      tokensBefore,
      tokensAfter: tokensBefore,
      width: info.width,
      height: info.height,
    };
  }
  return {
    model,
    method: result.method,
    tokensBefore,
    tokensAfter: result.estimatedTokens,
    width: result.width,
    height: result.height,
  };
}

function reduceContent(
  result: MethodResult | undefined,
  summary: ReturnType<typeof reduceSummary>,
): CallToolResult {
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
}

async function runReduce(
  image: string,
  model: TargetModel,
): Promise<CallToolResult> {
  const input = decodeImage(image);
  const info = await readImageInfo(input);
  const tokensBefore = unreducedTokens(info.width, info.height, model);
  const result = await resizeMethod.apply({ image: input, model });
  return reduceContent(
    result,
    reduceSummary(model, info, tokensBefore, result),
  );
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "image-token-saver", version: "0.1.0" });

  server.registerTool(
    "estimate_tokens",
    {
      description:
        "Estimate the input tokens of an image for a target model. Uses official formulas only.",
      inputSchema: toolInputSchema,
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
      inputSchema: toolInputSchema,
    },
    async ({ image, model }): Promise<CallToolResult> => {
      try {
        return await runReduce(image, model);
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";
import { syntheticImage } from "./synthetic.ts";

async function withClient(
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/cli.ts"],
    stderr: "ignore",
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

test("the server lists its tools", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["estimate_tokens", "reduce_image"]);
  });
});

test("reduce_image returns a smaller image and an estimate", async () => {
  await withClient(async (client) => {
    const png = await syntheticImage(1872, 1404, 3);
    const result = await client.callTool({
      name: "reduce_image",
      arguments: { image: png.toString("base64"), model: "claude-standard" },
    });
    assert.ok(!result.isError);
    const content = result.content as Array<{
      type: string;
      data?: string;
      text?: string;
    }>;
    const image = content.find((item) => item.type === "image");
    const text = content.find((item) => item.type === "text");
    assert.ok(image?.data);
    assert.ok(text?.text);
    const meta = await sharp(Buffer.from(image.data, "base64")).metadata();
    assert.deepEqual([meta.width, meta.height], [1270, 952]);
    const info = JSON.parse(text.text) as Record<string, unknown>;
    assert.equal(info.tokensBefore, 3417);
    assert.equal(info.tokensAfter, 1564);
    assert.equal(info.method, "resize");
    assert.equal(info.width, 1270);
    assert.equal(info.height, 952);
  });
});

test("estimate_tokens returns an estimate", async () => {
  await withClient(async (client) => {
    const png = await syntheticImage(936, 702, 1);
    const result = await client.callTool({
      name: "estimate_tokens",
      arguments: { image: png.toString("base64"), model: "claude-standard" },
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    const info = JSON.parse(content[0]?.text ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(info.tokens, 884);
  });
});

test("a bad image gives a tool error", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "reduce_image",
      arguments: { image: "bm90IGFuIGltYWdl", model: "gpt-4o" },
    });
    assert.equal(result.isError, true);
  });
});

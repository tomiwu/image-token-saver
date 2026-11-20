import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";
import { syntheticImage } from "./synthetic.ts";

async function connect(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/cli.ts"],
    stderr: "ignore",
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

test("the server lists its tools", async () => {
  const client = await connect();
  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["estimate_tokens", "reduce_image"]);
  } finally {
    await client.close();
  }
});

test("reduce_image returns a smaller image and an estimate", async () => {
  const client = await connect();
  try {
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
  } finally {
    await client.close();
  }
});

test("estimate_tokens returns an estimate", async () => {
  const client = await connect();
  try {
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
  } finally {
    await client.close();
  }
});

test("a bad image gives a tool error", async () => {
  const client = await connect();
  try {
    const result = await client.callTool({
      name: "reduce_image",
      arguments: { image: "bm90IGFuIGltYWdl", model: "gpt-4o" },
    });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
  }
});

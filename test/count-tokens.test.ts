import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareClaudeEstimate,
  countClaudeTokens,
  liveCountEnabled,
  type FetchLike,
} from "../src/count-tokens.ts";
import { syntheticImage } from "./synthetic.ts";

interface Call {
  url: string;
  init: { headers: Record<string, string>; body: string };
}

const KEY = "sk-ant-test-secret-value";

function stub(
  status: number,
  body: unknown,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

test("countClaudeTokens sends a base64 image to count_tokens", async () => {
  const png = await syntheticImage(64, 64, 3);
  const { fetch, calls } = stub(200, { input_tokens: 9 });
  const tokens = await countClaudeTokens(png, {
    apiKey: KEY,
    model: "claude-sonnet-5-5",
    fetch,
  });
  assert.equal(tokens, 9);
  assert.equal(
    calls[0].url,
    "https://api.anthropic.com/v1/messages/count_tokens",
  );
  assert.equal(calls[0].init.headers["x-api-key"], KEY);
  const body = JSON.parse(calls[0].init.body);
  const block = body.messages[0].content[0];
  assert.equal(block.type, "image");
  assert.equal(block.source.type, "base64");
  assert.equal(block.source.media_type, "image/png");
  assert.equal(block.source.data, png.toString("base64"));
});

test("compareClaudeEstimate reports estimate, count, and difference", async () => {
  const png = await syntheticImage(56, 56, 3);
  const { fetch } = stub(200, { input_tokens: 10 });
  const result = await compareClaudeEstimate(png, {
    apiKey: KEY,
    model: "claude-sonnet-5-5",
    fetch,
  });
  assert.equal(result.estimate, 4);
  assert.equal(result.counted, 10);
  assert.equal(result.difference, 6);
});

test("errors never contain the API key", async () => {
  const png = await syntheticImage(16, 16, 3);
  const { fetch } = stub(401, { error: { message: `bad key ${KEY}` } });
  await assert.rejects(
    countClaudeTokens(png, { apiKey: KEY, model: "m", fetch }),
    (error: Error) => {
      assert.ok(!error.message.includes(KEY));
      assert.match(error.message, /401/);
      return true;
    },
  );
});

test("liveCountEnabled needs key, opt-in, and no CI", () => {
  const on = { ANTHROPIC_API_KEY: KEY, IMAGE_TOKEN_SAVER_LIVE: "1" };
  assert.equal(liveCountEnabled(on), true);
  assert.equal(liveCountEnabled({ ...on, CI: "true" }), false);
  assert.equal(
    liveCountEnabled({ ...on, IMAGE_TOKEN_SAVER_LIVE: undefined }),
    false,
  );
  assert.equal(liveCountEnabled({ IMAGE_TOKEN_SAVER_LIVE: "1" }), false);
  assert.equal(liveCountEnabled({ ...on, ANTHROPIC_API_KEY: "" }), false);
});

test(
  "live count_tokens comparison (optional)",
  { skip: !liveCountEnabled(process.env) },
  async () => {
    const png = await syntheticImage(560, 420, 3);
    const result = await compareClaudeEstimate(png, {
      apiKey: process.env.ANTHROPIC_API_KEY as string,
      model: "claude-sonnet-5-5",
    });
    assert.ok(result.counted > 0);
    console.log(
      `count_tokens: estimate=${result.estimate} counted=${result.counted} difference=${result.difference}`,
    );
  },
);

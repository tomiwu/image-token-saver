/**
 * Promptfoo JavaScript provider wrapping subscription CLIs:
 *   claude -p   (Claude Code OAuth)
 *   agent  -p   (Cursor CLI)
 * No API keys. Returns answer text and measured tokenUsage when the CLI
 * actually reports usage numbers. Does not invent counts.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_TIMEOUT_MS = 240_000;

function rawDir() {
  const root = process.env.EVALS_IMAGE_DIR;
  if (!root) {
    throw new Error("EVALS_IMAGE_DIR is not set");
  }
  return join(root, "raw");
}

function scaleName(context) {
  return context?.vars?.scale || "unknown";
}

function cachePath(providerId, context) {
  const safe = `${providerId}__${scaleName(context)}`.replace(/[^\w.-]+/g, "_");
  return join(rawDir(), `${safe}.json`);
}

function asInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function pickUsage(obj) {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }
  const uncached = asInt(
    obj.input_tokens ??
      obj.prompt_tokens ??
      obj.inputTokens ??
      obj.promptTokens ??
      obj.prompt,
  );
  const cacheCreate = asInt(
    obj.cache_creation_input_tokens ?? obj.cacheCreationInputTokens,
  );
  const cacheRead = asInt(
    obj.cache_read_input_tokens ?? obj.cacheReadInputTokens,
  );
  const completion = asInt(
    obj.output_tokens ??
      obj.completion_tokens ??
      obj.outputTokens ??
      obj.completionTokens ??
      obj.completion,
  );
  const total = asInt(obj.total_tokens ?? obj.totalTokens ?? obj.total);
  if (
    uncached === undefined &&
    cacheCreate === undefined &&
    cacheRead === undefined &&
    completion === undefined &&
    total === undefined
  ) {
    return undefined;
  }
  const usage = {};
  if (
    uncached !== undefined ||
    cacheCreate !== undefined ||
    cacheRead !== undefined
  ) {
    usage.prompt = (uncached || 0) + (cacheCreate || 0) + (cacheRead || 0);
  }
  if (completion !== undefined) usage.completion = completion;
  if (total !== undefined) {
    usage.total = total;
  } else if (usage.prompt !== undefined || completion !== undefined) {
    usage.total = (usage.prompt || 0) + (completion || 0);
  }
  return usage;
}

function walkUsage(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) {
    return undefined;
  }
  const direct =
    pickUsage(value) ||
    pickUsage(value.usage) ||
    pickUsage(value.tokenUsage) ||
    pickUsage(value.tokens);
  if (direct) {
    return direct;
  }
  for (const key of ["result", "data", "response", "info"]) {
    if (value[key] && typeof value[key] === "object") {
      const found = walkUsage(value[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function extractText(payload, stdout) {
  if (payload && typeof payload === "object") {
    for (const key of ["result", "output", "text", "message", "content"]) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    if (typeof payload.response === "string" && payload.response.trim()) {
      return payload.response.trim();
    }
    if (payload.response && typeof payload.response.text === "string") {
      return payload.response.text.trim();
    }
  }
  return String(stdout || "").trim();
}

function extractModel(payload) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  if (payload.model || payload.modelId || payload.model_id) {
    return payload.model || payload.modelId || payload.model_id;
  }
  if (payload.info?.model) return payload.info.model;
  const usage = payload.modelUsage;
  if (usage && typeof usage === "object") {
    const first = Object.values(usage)[0];
    if (first && typeof first === "object" && first.canonicalModel) {
      return first.canonicalModel;
    }
    const names = Object.keys(usage);
    if (names.length) return names[0];
  }
  return undefined;
}

function parseCliJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) {
    return { payload: undefined, output: "" };
  }
  try {
    return { payload: JSON.parse(text), output: undefined };
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return {
          payload: JSON.parse(text.slice(start, end + 1)),
          output: undefined,
        };
      } catch {
        return { payload: undefined, output: text };
      }
    }
    return { payload: undefined, output: text };
  }
}

function runCommand(command, args, { timeoutMs, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Subscription CLIs must use the box login, not an API key.
    delete env.CURSOR_API_KEY;
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_API_KEY;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function buildArgs(config, prompt, image) {
  const cli = config.cli;
  if (cli === "claude") {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--tools",
      "Read",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--add-dir",
      dirname(image),
    ];
    if (config.model) {
      args.push("--model", config.model);
    }
    return { command: "claude", args };
  }
  if (cli === "agent") {
    if (!config.model) {
      throw new Error("agent provider requires config.model");
    }
    return {
      command: "agent",
      args: [
        "-p",
        prompt,
        "--model",
        config.model,
        "--mode",
        "ask",
        "--trust",
        "--output-format",
        "json",
        "--add-dir",
        dirname(image),
      ],
    };
  }
  throw new Error(`Unknown cli ${cli}`);
}

async function loadCached(path) {
  if (process.env.EVALS_FORCE_RERUN === "1") {
    return undefined;
  }
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (data && typeof data.output === "string" && data.output.trim()) {
      return data;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export default class SubscriptionCliProvider {
  constructor(options = {}) {
    this.config = options.config || {};
    this.providerId = this.config.id || options.id || "subscription-cli";
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, context) {
    const image = context?.vars?.image;
    if (!image) {
      return { error: "Test var 'image' is missing" };
    }
    const path = cachePath(this.providerId, context);
    await mkdir(dirname(path), { recursive: true });
    const cached = await loadCached(path);
    if (cached) {
      return {
        output: cached.output,
        tokenUsage: cached.tokenUsage,
        metadata: {
          reused: true,
          model: cached.model,
          rawPath: path,
        },
      };
    }

    const { command, args } = buildArgs(this.config, prompt, image);
    const timeoutMs = Number(this.config.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const cwd = process.env.EVALS_WORKSPACE || process.cwd();
    let ran;
    try {
      ran = await runCommand(command, args, { timeoutMs, cwd });
    } catch (err) {
      return { error: String(err?.message || err) };
    }

    const parsed = parseCliJson(ran.stdout);
    const output = (
      parsed.output || extractText(parsed.payload, ran.stdout)
    ).trim();
    const tokenUsage = walkUsage(parsed.payload);
    const model = extractModel(parsed.payload);
    const record = {
      provider: this.providerId,
      scale: scaleName(context),
      image,
      command,
      // Do not store args that might be huge; store the prompt and model only.
      model,
      output,
      tokenUsage: tokenUsage || null,
      usageRaw: parsed.payload?.usage || parsed.payload?.tokenUsage || null,
      exitCode: ran.code,
      stderr: ran.stderr.slice(0, 8000),
      createdAt: new Date().toISOString(),
      reused: false,
    };
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);

    if (!output) {
      return {
        error: `Empty output from ${command} (exit ${ran.code}): ${ran.stderr.slice(0, 500)}`,
        metadata: { rawPath: path, model },
      };
    }
    return {
      output,
      tokenUsage,
      metadata: { reused: false, model, rawPath: path, exitCode: ran.code },
    };
  }
}

import { spawn } from "node:child_process";
import { CalibrationError, SIDES, type Side } from "./types.ts";
import type {
  LlmRefiner,
  LlmRequest,
  LlmVerdict,
  SideVerdict,
} from "./llm-refine.ts";

export const PROMPT = [
  "Image 1 is a front view of an e-ink screen. Image 2 is the camera frame with the four screen corners drawn.",
  "For each side (top, right, bottom, left) of image 1 decide two things.",
  "nonUiVisible: true when bezel, wall or frame is visible at that side.",
  "uiCutOff: true when the screen UI is cut off at that side.",
  "offsetPx: how many pixels of image 1 to move that edge inward (positive) or outward (negative). Use 0 when the side is clean.",
  'Answer with strict JSON only, for example {"top":{"nonUiVisible":false,"uiCutOff":false,"offsetPx":0},"right":{...},"bottom":{...},"left":{...}}.',
].join(" ");

export function buildMessage(request: LlmRequest): string {
  const image = (data: Buffer) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: data.toString("base64"),
    },
  });
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        image(request.front),
        image(request.overlay),
        { type: "text", text: PROMPT },
      ],
    },
  })}\n`;
}

export const CLAUDE_ARGS = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--permission-mode",
  "dontAsk",
  "--tools",
  "",
];

function runClaude(bin: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, CLAUDE_ARGS, {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () =>
      reject(new CalibrationError("The claude CLI was not found on PATH.")),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(
            new CalibrationError(`The claude CLI exited with code ${code}.`),
          ),
    );
    child.stdin.end(stdin);
  });
}

interface ResultLine {
  result?: string;
  usage?: Record<string, number>;
}

function lastResult(stdout: string): ResultLine {
  const lines = stdout.split(/\r?\n/).filter((l) => l.startsWith("{"));
  for (const line of lines.reverse()) {
    try {
      const payload = JSON.parse(line) as ResultLine & { type?: string };
      if (payload.type === "result") {
        return payload;
      }
    } catch {
      continue;
    }
  }
  throw new CalibrationError("The claude CLI returned no result.");
}

const USAGE_KEYS = [
  "input_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "output_tokens",
];

export function measuredTokens(
  usage: Record<string, number> | undefined,
): number | undefined {
  if (!usage) {
    return undefined;
  }
  return USAGE_KEYS.reduce((sum, key) => sum + (usage[key] ?? 0), 0);
}

function readSide(value: unknown, side: Side): SideVerdict {
  const entry = value as Partial<SideVerdict> | undefined;
  const valid =
    typeof entry?.nonUiVisible === "boolean" &&
    typeof entry.uiCutOff === "boolean" &&
    typeof entry.offsetPx === "number" &&
    Number.isFinite(entry.offsetPx);
  if (!valid) {
    throw new CalibrationError(`The LLM answer has no valid "${side}" entry.`);
  }
  return entry as SideVerdict;
}

export function parseVerdict(text: string): Record<Side, SideVerdict> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new CalibrationError("The LLM answer is not strict JSON.");
  }
  return Object.fromEntries(
    SIDES.map((side) => [side, readSide(value[side], side)]),
  ) as Record<Side, SideVerdict>;
}

export function createClaudeRefiner(bin = "claude"): LlmRefiner {
  return {
    async review(request: LlmRequest): Promise<LlmVerdict> {
      const stdout = await runClaude(bin, buildMessage(request));
      const result = lastResult(stdout);
      return {
        sides: parseVerdict(result.result ?? ""),
        tokens: measuredTokens(result.usage),
      };
    },
  };
}

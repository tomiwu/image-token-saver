export type TargetModel =
  | "claude-standard"
  | "claude-high-res"
  | "gpt-4o"
  | "gpt-4.1-mini"
  | "gpt-5.2"
  | "gemini-3";

export type ClaudeMode = "raw" | "standard" | "high-res";
export type GeminiResolution = "low" | "medium" | "high" | "ultra_high";

export interface SizeEstimate {
  width: number;
  height: number;
  tokens: number;
}

const CLAUDE_PATCH = 28;
const CLAUDE_LIMITS = {
  standard: { maxEdge: 1568, maxTokens: 1568 },
  "high-res": { maxEdge: 2576, maxTokens: 4784 },
} as const;

function claudePatches(width: number, height: number): number {
  return Math.ceil(width / CLAUDE_PATCH) * Math.ceil(height / CLAUDE_PATCH);
}

export function claudeResizedSize(
  width: number,
  height: number,
  maxEdge: number,
  maxTokens: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const fits = (w: number, h: number): boolean =>
    Math.max(w, h) <= maxEdge && claudePatches(w, h) <= maxTokens;
  if (fits(width, height)) {
    return { width, height };
  }
  const sizeFor = (edge: number): { width: number; height: number } => ({
    width: Math.max(1, Math.floor((width * edge) / longest)),
    height: Math.max(1, Math.floor((height * edge) / longest)),
  });
  let low = 1;
  let high = longest;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const size = sizeFor(mid);
    if (fits(size.width, size.height)) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return sizeFor(low);
}

export function estimateClaude(
  width: number,
  height: number,
  mode: ClaudeMode,
): SizeEstimate {
  const size =
    mode === "raw"
      ? { width, height }
      : claudeResizedSize(
          width,
          height,
          CLAUDE_LIMITS[mode].maxEdge,
          CLAUDE_LIMITS[mode].maxTokens,
        );
  return { ...size, tokens: claudePatches(size.width, size.height) };
}

const GPT4O_BASE_TOKENS = 85;
const GPT4O_TILE_TOKENS = 170;
const GPT4O_TILE = 512;
const GPT4O_MAX_LONG_EDGE = 2048;
const GPT4O_MAX_SHORT_EDGE = 768;

export function estimateGpt4oTiles(
  width: number,
  height: number,
  detail: "low" | "high",
): SizeEstimate & { tiles: number } {
  if (detail === "low") {
    return { width, height, tiles: 0, tokens: GPT4O_BASE_TOKENS };
  }
  let w = width;
  let h = height;
  const longest = Math.max(w, h);
  if (longest > GPT4O_MAX_LONG_EDGE) {
    const scale = GPT4O_MAX_LONG_EDGE / longest;
    w = Math.floor(w * scale);
    h = Math.floor(h * scale);
  }
  const shortest = Math.min(w, h);
  if (shortest > GPT4O_MAX_SHORT_EDGE) {
    const scale = GPT4O_MAX_SHORT_EDGE / shortest;
    w = Math.floor(w * scale);
    h = Math.floor(h * scale);
  }
  const tiles = Math.ceil(w / GPT4O_TILE) * Math.ceil(h / GPT4O_TILE);
  return {
    width: w,
    height: h,
    tiles,
    tokens: GPT4O_BASE_TOKENS + GPT4O_TILE_TOKENS * tiles,
  };
}

const GPT_PATCH = 32;
const GPT_MAX_EDGE = 2048;
const GPT_PATCH_BUDGET = 6144;
const GPT_MULTIPLIER = { "gpt-4.1-mini": 1.62, "gpt-5.2": 1.2 } as const;

export function estimateGptPatch(
  width: number,
  height: number,
  model: keyof typeof GPT_MULTIPLIER,
): SizeEstimate & { patches: number } {
  let w = width;
  let h = height;
  const longest = Math.max(w, h);
  if (longest > GPT_MAX_EDGE) {
    const scale = GPT_MAX_EDGE / longest;
    w = Math.floor(w * scale);
    h = Math.floor(h * scale);
  }
  const patchCount = (): number =>
    Math.ceil(w / GPT_PATCH) * Math.ceil(h / GPT_PATCH);
  if (patchCount() > GPT_PATCH_BUDGET) {
    const shrink = Math.sqrt((GPT_PATCH ** 2 * GPT_PATCH_BUDGET) / (w * h));
    const wPatches = (w * shrink) / GPT_PATCH;
    const hPatches = (h * shrink) / GPT_PATCH;
    const fix = Math.min(
      Math.floor(wPatches) / wPatches,
      Math.floor(hPatches) / hPatches,
    );
    w = Math.max(1, Math.floor(w * shrink * fix));
    h = Math.max(1, Math.floor(h * shrink * fix));
  }
  const patches = patchCount();
  return {
    width: w,
    height: h,
    patches,
    tokens: Math.ceil(patches * GPT_MULTIPLIER[model]),
  };
}

const GEMINI_TOKENS: Record<GeminiResolution, number> = {
  low: 280,
  medium: 560,
  high: 1120,
  ultra_high: 2240,
};

export function estimateGeminiTokens(
  resolution: GeminiResolution = "high",
): number {
  return GEMINI_TOKENS[resolution];
}

export function estimateTokens(
  width: number,
  height: number,
  model: TargetModel,
): number {
  switch (model) {
    case "claude-standard":
      return estimateClaude(width, height, "standard").tokens;
    case "claude-high-res":
      return estimateClaude(width, height, "high-res").tokens;
    case "gpt-4o":
      return estimateGpt4oTiles(width, height, "high").tokens;
    case "gpt-4.1-mini":
    case "gpt-5.2":
      return estimateGptPatch(width, height, model).tokens;
    case "gemini-3":
      return estimateGeminiTokens();
  }
}

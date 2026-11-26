import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { adjust } from "../src/calibrate/adjust.ts";
import { loadWarper } from "../src/calibrate/apply.ts";
import { calibrate } from "../src/calibrate/calibrate.ts";
import {
  assertInputSize,
  parseCalibration,
  pendingPath,
  phoneCheckPath,
  readCalibration,
  type Calibration,
} from "../src/calibrate/calibration-file.ts";
import {
  assertChecks,
  checkAspect,
  checkConvex,
  checkCorners,
  checkStraight,
  runChecks,
} from "../src/calibrate/checks.ts";
import {
  PROMPT,
  buildMessage,
  createClaudeRefiner,
  measuredTokens,
  parseVerdict,
} from "../src/calibrate/llm-claude.ts";
import {
  MAX_LLM_CALLS,
  refineWithLlm,
  verdictOffsets,
  type LlmRefiner,
  type LlmRequest,
  type LlmVerdict,
  type SideVerdict,
} from "../src/calibrate/llm-refine.ts";
import { INSTRUCTION } from "../src/calibrate/phone-check.ts";
import {
  allStripsClean,
  edgeStripReport,
} from "../src/calibrate/strip-check.ts";
import { detectPanel } from "../src/calibrate/detect.ts";
import { loadGray } from "../src/calibrate/mask.ts";
import { decodeRgb } from "../src/calibrate/warp.ts";
import {
  CalibrationError,
  type Corners,
  type Side,
} from "../src/calibrate/types.ts";
import {
  runCalibrate,
  runCaptureCommand,
  parseAspect,
  parsePanel,
  parsePositive,
  parseTarget,
  splitFlags,
} from "../src/calibrate/cli-calibrate.ts";
import { CAPTURE_SIZE, captureArgs } from "../src/calibrate/capture.ts";
import { main } from "../src/cli.ts";
import { SCENE_CORNERS, renderScene } from "./calibrate-scene.ts";

const FRAME = { width: 640, height: 480 };
const OUTSIDE: Corners = {
  tl: [60, -40],
  tr: [540, 40],
  br: [520, 420],
  bl: [-30, 380],
};

async function workDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "its-cal-"));
}

async function writeScene(
  dir: string,
  corners: Corners = SCENE_CORNERS,
): Promise<string> {
  const path = join(dir, "scene.png");
  await writeFile(path, await renderScene(FRAME.width, FRAME.height, corners));
  return path;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function verdict(overrides: Partial<Record<Side, SideVerdict>>, tokens = 100) {
  const clean: SideVerdict = {
    nonUiVisible: false,
    uiCutOff: false,
    offsetPx: 0,
  };
  return {
    sides: {
      top: clean,
      right: clean,
      bottom: clean,
      left: clean,
      ...overrides,
    },
    tokens,
  } as LlmVerdict;
}

function fakeRefiner(
  answers: LlmVerdict[],
): LlmRefiner & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async review(request) {
      requests.push(request);
      return answers[Math.min(requests.length - 1, answers.length - 1)];
    },
  };
}

function wants(side: Side, offsetPx: number): LlmVerdict {
  return verdict({ [side]: { nonUiVisible: true, uiCutOff: false, offsetPx } });
}

async function withPath<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const saved = process.env.PATH;
  process.env.PATH = dir.includes(":")
    ? dir
    : `${dir}:${dirname(process.execPath)}`;
  try {
    return await run();
  } finally {
    process.env.PATH = saved;
  }
}

async function writeScript(dir: string, name: string, body: string) {
  const path = join(dir, name);
  await writeFile(path, `#!/usr/bin/env node\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

test("checks: corner outside the frame by more than N px fails and names the corner", () => {
  const outside = checkCorners(OUTSIDE, FRAME);
  assert.equal(outside.pass, false);
  assert.match(outside.detail, /corner TL is 40\.0 px outside the frame/);
  assert.match(outside.detail, /corner BL is 30\.0 px outside the frame/);
  assert.equal(checkCorners(SCENE_CORNERS, FRAME).pass, true);
  const near: Corners = { ...SCENE_CORNERS, tl: [-11, 70] };
  assert.equal(checkCorners(near, FRAME).pass, true);
  const over: Corners = { ...SCENE_CORNERS, tl: [-13, 70] };
  assert.equal(checkCorners(over, FRAME).pass, false);
  assert.equal(checkCorners(over, FRAME, 20).pass, true);
});

test("checks: convex, aspect and straight edges", () => {
  assert.equal(checkConvex(SCENE_CORNERS).pass, true);
  const bowtie: Corners = {
    tl: SCENE_CORNERS.tr,
    tr: SCENE_CORNERS.tl,
    br: SCENE_CORNERS.br,
    bl: SCENE_CORNERS.bl,
  };
  assert.equal(checkConvex(bowtie).pass, false);
  assert.equal(checkAspect({ width: 1872, height: 1404 }, 4 / 3).pass, true);
  assert.equal(checkAspect({ width: 1920, height: 1080 }, 4 / 3).pass, false);
  const target = { width: 1872, height: 1404 };
  const straight: Record<Side, [number, number][]> = {
    top: [
      [110, 70],
      [325, 82],
      [540, 95],
    ],
    right: [
      [540, 95],
      [530, 257],
      [520, 420],
    ],
    bottom: [
      [520, 420],
      [307, 405],
      [95, 390],
    ],
    left: [
      [95, 390],
      [102, 230],
      [110, 70],
    ],
  };
  assert.equal(checkStraight(SCENE_CORNERS, target, straight).pass, true);
  const bent = {
    ...straight,
    top: [...straight.top.slice(0, 1), [325, 140], straight.top[2]],
  };
  const result = checkStraight(SCENE_CORNERS, target, bent as typeof straight);
  assert.equal(result.pass, false);
  assert.match(result.detail, /top/);
  assert.throws(() => assertChecks([result]), /Calibration check failed/);
});

test("calibrate writes a draft and a phone check, not calibration.json", async () => {
  const dir = await workDir();
  const out = join(dir, "calibration.json");
  const text = await calibrate({
    image: await writeScene(dir),
    out,
    now: () => new Date("2026-11-26T12:00:00Z"),
  });
  assert.match(text, /phone-check=.*phone-check\.png/);
  assert.ok(text.includes(INSTRUCTION));
  assert.equal(await exists(out), false);
  const draft = JSON.parse(await readFile(pendingPath(out), "utf8"));
  assert.deepEqual(draft.capture, FRAME);
  assert.equal(draft.created, "2026-11-26T12:00:00.000Z");
  assert.equal(draft.llm_refine, undefined);
  assert.ok(draft.checks.every((c: { pass: boolean }) => c.pass));
  const meta = await sharp(phoneCheckPath(out)).metadata();
  assert.equal(meta.width, 1092);
  assert.ok((meta.height ?? 0) > 819);
});

test("calibrate fails with exit 1 and writes nothing when a corner is outside the frame", async () => {
  const dir = await workDir();
  const out = join(dir, "calibration.json");
  const image = await writeScene(dir, OUTSIDE);
  await assert.rejects(
    calibrate({ image, out }),
    /corner TL is \d+\.\d px outside the frame \(limit 12 px\)/,
  );
  assert.equal(await exists(out), false);
  assert.equal(await exists(pendingPath(out)), false);
  assert.equal(await exists(phoneCheckPath(out)), false);
  const code = await main(["calibrate", "--image", image, "--out", out]);
  assert.equal(code, 1);
});

test("adjust ok saves calibration.json from the draft without a running calibrate", async () => {
  const dir = await workDir();
  const out = join(dir, "calibration.json");
  await calibrate({ image: await writeScene(dir), out });
  const message = await adjust({ cal: out, words: ["OK"] });
  assert.match(message, /calibration=/);
  const cal = await readCalibration(out);
  assert.deepEqual(cal.capture, FRAME);
  assert.deepEqual(cal.target, { width: 1872, height: 1404 });
  assert.equal(cal.k1, 0);
  assert.ok(cal.checks.length === 4);
  assert.equal(await exists(pendingPath(out)), false);
  assert.equal(JSON.parse(await readFile(out, "utf8")).source, undefined);
});

test("adjust moves edges in front-view pixels and keeps the draft", async () => {
  const dir = await workDir();
  const out = join(dir, "calibration.json");
  await calibrate({ image: await writeScene(dir), out });
  const before = JSON.parse(await readFile(pendingPath(out), "utf8"));
  await adjust({ cal: out, words: ["right", "20", "bottom", "8"] });
  const after = await readCalibration(out);
  assert.ok(after.corners.tr[0] < before.corners.tr[0]);
  assert.ok(after.corners.bl[1] < before.corners.bl[1]);
  assert.deepEqual(after.adjustments, [{ right: 20, bottom: 8 }]);
  assert.ok(await exists(pendingPath(out)));
  await adjust({ cal: out, words: ["left", "-4"] });
  const again = await readCalibration(out);
  assert.equal(again.adjustments.length, 2);
  assert.ok(again.corners.tl[0] < after.corners.tl[0]);
});

test("adjust that fails a check keeps the old calibration.json and exits 1", async () => {
  const dir = await workDir();
  const out = join(dir, "calibration.json");
  await calibrate({ image: await writeScene(dir), out });
  await adjust({ cal: out, words: ["ok"] });
  await calibrate({ image: await writeScene(dir), out });
  const saved = await readFile(out, "utf8");
  await assert.rejects(
    adjust({ cal: out, words: ["left", "-300"] }),
    /corner \w\w is .* outside the frame/,
  );
  assert.equal(await readFile(out, "utf8"), saved);
  const code = await main([
    "calibrate",
    "adjust",
    "left",
    "-300",
    "--cal",
    out,
  ]);
  assert.equal(code, 1);
  assert.equal(await readFile(out, "utf8"), saved);
});

test("adjust without a draft explains what to do", async () => {
  const dir = await workDir();
  await assert.rejects(
    adjust({ cal: join(dir, "calibration.json"), words: ["ok"] }),
    /No draft found/,
  );
});

test("calibration files: parse, read and size refusal", async () => {
  assert.throws(() => parseCalibration("{", "x.json"), /not valid JSON/);
  assert.throws(
    () => parseCalibration("{}", "x.json"),
    /not a calibration file/,
  );
  const dir = await workDir();
  await assert.rejects(
    readCalibration(join(dir, "none.json")),
    /cannot be read/,
  );
  const cal = { capture: { width: 640, height: 480 } } as Calibration;
  assertInputSize(cal, { width: 640, height: 480 });
  assert.throws(
    () => assertInputSize(cal, { width: 1280, height: 720 }),
    /input size 1280x720 does not match the calibration capture size 640x480/,
  );
});

async function calibratedDir(): Promise<{
  dir: string;
  cal: string;
  scene: string;
}> {
  const dir = await workDir();
  const cal = join(dir, "calibration.json");
  const scene = await writeScene(dir);
  await calibrate({ image: scene, out: cal });
  await adjust({ cal, words: ["ok"] });
  return { dir, cal, scene };
}

test("--cal warps to the 4:3 target with --width and refuses other sizes", async () => {
  const { dir, cal, scene } = await calibratedDir();
  const standard = await loadWarper(cal);
  assert.deepEqual(standard.size, { width: 448, height: 336 });
  const meta = await sharp(await standard.warp(scene)).metadata();
  assert.deepEqual([meta.width, meta.height], [448, 336]);
  const wide = await loadWarper(cal, 224);
  const small = await sharp(await wide.warp(scene)).metadata();
  assert.deepEqual([small.width, small.height], [224, 168]);
  const other = join(dir, "other.png");
  await writeFile(other, await renderScene(320, 240));
  await assert.rejects(
    standard.warp(other),
    /input size 320x240 does not match the calibration capture size 640x480/,
  );
});

test("estimate, reduce and video use --cal and --width", async () => {
  const { dir, cal, scene } = await calibratedDir();
  const lines: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    assert.equal(
      await main(["estimate", scene, "--model", "claude", "--cal", cal]),
      0,
    );
    assert.equal(
      await main([
        "estimate",
        scene,
        "--model",
        "claude",
        "--cal",
        cal,
        "--width",
        "224",
      ]),
      0,
    );
    const out = join(dir, "reduced.png");
    assert.equal(
      await main([
        "reduce",
        scene,
        "--model",
        "claude",
        "--cal",
        cal,
        "--method",
        "diff",
        "--prev",
        scene,
        "--out",
        out,
      ]),
      0,
    );
    const framesDir = await workDir();
    await sharp(scene).toFile(join(framesDir, "a.png"));
    await sharp(scene).toFile(join(framesDir, "b.png"));
    const outDir = join(dir, "video-out");
    assert.equal(
      await main(["video", framesDir, "--cal", cal, "--out-dir", outDir]),
      0,
    );
  } finally {
    process.stdout.write = write;
  }
  const text = lines.join("");
  assert.match(text, /size=448x336/);
  assert.match(text, /size=224x168/);
  assert.match(text, /warped\/frame-000001\.png/);
  const frame = await sharp(
    join(dir, "video-out", "warped", "frame-000001.png"),
  ).metadata();
  assert.equal(frame.width, 448);
});

test("--width needs --cal and wrong sizes are refused", async () => {
  const { dir, cal } = await calibratedDir();
  const small = join(dir, "small.png");
  await writeFile(small, await renderScene(320, 240));
  const errors: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string) => {
    errors.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    assert.equal(
      await main(["estimate", small, "--model", "claude", "--width", "100"]),
      1,
    );
    assert.equal(
      await main(["estimate", small, "--model", "claude", "--cal", cal]),
      1,
    );
    assert.equal(
      await main(["estimate", small, "--model", "claude", "--width", "0"]),
      1,
    );
    assert.equal(await main(["video", dir, "--width", "50"]), 1);
  } finally {
    process.stderr.write = write;
  }
  const text = errors.join("");
  assert.match(text, /needs --cal/);
  assert.match(text, /does not match the calibration capture size/);
  assert.match(text, /positive integer/);
});

test("phone check width stays at or below 1092 px", async () => {
  const dir = await workDir();
  const out = join(dir, "calibration.json");
  await calibrate({
    image: await writeScene(dir),
    out,
    target: { width: 1600, height: 1200 },
  });
  const meta = await sharp(phoneCheckPath(out)).metadata();
  assert.ok((meta.width ?? 0) <= 1092);
});

test("LLM refine is off by default and the claude CLI is not run", async () => {
  const dir = await workDir();
  const bin = await workDir();
  const marker = join(dir, "marker");
  await writeScript(
    bin,
    "claude",
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "called");`,
  );
  const image = await writeScene(dir);
  await withPath(`${bin}:${process.env.PATH}`, () =>
    runCalibrate(["--image", image, "--out", join(dir, "calibration.json")]),
  );
  assert.equal(await exists(marker), false);
  const draft = JSON.parse(
    await readFile(pendingPath(join(dir, "calibration.json")), "utf8"),
  );
  assert.equal(draft.llm_refine, undefined);
});

test("--llm runs the claude CLI and saves rounds with measured tokens", async () => {
  const dir = await workDir();
  const bin = await workDir();
  const clean = { nonUiVisible: false, uiCutOff: false, offsetPx: 0 };
  const answer = JSON.stringify({
    top: clean,
    right: clean,
    bottom: clean,
    left: clean,
  });
  const result = {
    type: "result",
    result: answer,
    usage: { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 },
  };
  await writeScript(
    bin,
    "claude",
    `process.stdin.resume(); process.stdin.on("end", () => console.log(${JSON.stringify(JSON.stringify(result))}));`,
  );
  const image = await writeScene(dir);
  const out = join(dir, "calibration.json");
  await withPath(`${bin}:${process.env.PATH}`, () =>
    runCalibrate([
      "--image",
      image,
      "--out",
      out,
      "--llm",
      "--llm-width",
      "448",
    ]),
  );
  const draft = JSON.parse(await readFile(pendingPath(out), "utf8"));
  assert.equal(draft.llm_refine.rounds.length, 1);
  assert.equal(draft.llm_refine.rounds[0].tokens, 115);
  assert.equal(draft.llm_refine.totalTokens, 115);
  await adjust({ cal: out, words: ["ok"] });
  assert.equal((await readCalibration(out)).llm_refine?.totalTokens, 115);
});

async function refineContext(corners: Corners = SCENE_CORNERS) {
  const bytes = await renderScene(FRAME.width, FRAME.height);
  const found = detectPanel(await loadGray(bytes), "light");
  return {
    source: await decodeRgb(bytes),
    corners,
    k1: 0,
    capture: FRAME,
    target: { width: 1872, height: 1404 },
    aspect: 4 / 3,
    edgePoints: found.edgePoints,
    width: 448,
    overlay: async () => Buffer.from("overlay"),
  };
}

test("refine stops after one call when every side is clean", async () => {
  const refiner = fakeRefiner([verdict({})]);
  const result = await refineWithLlm(refiner, await refineContext());
  assert.equal(refiner.requests.length, 1);
  assert.equal(result.rounds[0].applied, false);
  assert.deepEqual(result.corners, SCENE_CORNERS);
  assert.equal(result.totalTokens, 100);
  assert.equal(refiner.requests[0].frontWidth, 448);
});

test("refine stops after one call when the edge-strip check says clean", async () => {
  const refiner = fakeRefiner([wants("right", 4), wants("right", 4)]);
  const result = await refineWithLlm(refiner, await refineContext());
  assert.equal(refiner.requests.length, 1);
  assert.equal(result.rounds[0].applied, true);
  assert.equal(result.rounds[0].note, "edge strips clean");
  assert.ok(result.corners.tr[0] < SCENE_CORNERS.tr[0]);
});

test("refine makes at most two LLM calls when the strips stay unclean", async () => {
  const refiner = fakeRefiner([
    wants("right", -22),
    wants("right", -4),
    wants("right", -4),
  ]);
  const result = await refineWithLlm(refiner, await refineContext());
  assert.equal(MAX_LLM_CALLS, 2);
  assert.equal(refiner.requests.length, 2);
  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[0].note, "edge strips not clean");
  assert.equal(result.totalTokens, 200);
});

test("refine reverts a round that fails a check and stops", async () => {
  const edge: Corners = { ...SCENE_CORNERS, tl: [8, 70], bl: [8, 390] };
  const refiner = fakeRefiner([wants("left", -60), wants("left", -1)]);
  const result = await refineWithLlm(refiner, await refineContext(edge));
  assert.equal(refiner.requests.length, 1);
  assert.equal(result.rounds[0].applied, false);
  assert.match(result.rounds[0].note, /^reverted: corner/);
  assert.deepEqual(result.corners, edge);
});

test("refine ignores a side offset when the side is clean and clamps big offsets", () => {
  const answer = verdict({
    top: { nonUiVisible: false, uiCutOff: false, offsetPx: 9 },
    left: { nonUiVisible: true, uiCutOff: false, offsetPx: 500 },
    bottom: { nonUiVisible: false, uiCutOff: true, offsetPx: -500 },
    right: { nonUiVisible: true, uiCutOff: false, offsetPx: 0 },
  });
  assert.deepEqual(verdictOffsets(answer, 2), { left: 60, bottom: -60 });
});

test("edge strips flag bezel at the border of the front view", async () => {
  const clean = await decodeRgb(await renderScene(FRAME.width, FRAME.height));
  const data = Buffer.alloc(100 * 100 * 3, 240);
  for (let y = 0; y < 100; y++) {
    data.fill(20, (y * 100 + 97) * 3, (y * 100 + 100) * 3);
  }
  const report = edgeStripReport({ data, width: 100, height: 100 });
  assert.equal(report.find((r) => r.side === "right")?.clean, false);
  assert.equal(report.find((r) => r.side === "left")?.clean, true);
  assert.equal(allStripsClean(report), false);
  assert.equal(clean.width, FRAME.width);
});

test("claude refiner reads the CLI result and measured usage", async () => {
  const bin = await workDir();
  const clean = { nonUiVisible: false, uiCutOff: true, offsetPx: 3 };
  const answer = `Here: ${JSON.stringify({ top: clean, right: clean, bottom: clean, left: clean })}`;
  const line = JSON.stringify({
    type: "result",
    result: answer,
    usage: { input_tokens: 7, output_tokens: 3 },
  });
  const path = await writeScript(
    bin,
    "claude-ok",
    `process.stdin.resume(); process.stdin.on("end", () => console.log("noise\\n{bad\\n" + ${JSON.stringify(line)}));`,
  );
  const request = {
    front: Buffer.from("a"),
    overlay: Buffer.from("b"),
    frontWidth: 448,
    round: 1,
  };
  const result = await createClaudeRefiner(path).review(request);
  assert.equal(result.tokens, 10);
  assert.equal(result.sides.top.offsetPx, 3);
  const message = JSON.parse(buildMessage(request));
  assert.equal(message.message.content.length, 3);
  assert.equal(message.message.content[2].text, PROMPT);
  assert.equal(measuredTokens(undefined), undefined);
});

test("claude refiner reports a bad CLI answer", async () => {
  const bin = await workDir();
  const request = {
    front: Buffer.from("a"),
    overlay: Buffer.from("b"),
    frontWidth: 448,
    round: 1,
  };
  const none = await writeScript(
    bin,
    "none",
    `process.stdin.resume(); process.stdin.on("end", () => console.log("{\\"type\\":\\"assistant\\"}"));`,
  );
  await assert.rejects(createClaudeRefiner(none).review(request), /no result/);
  const failing = await writeScript(bin, "fail", "process.exit(3);");
  await assert.rejects(createClaudeRefiner(failing).review(request), /code 3/);
  await assert.rejects(
    createClaudeRefiner(join(bin, "missing")).review(request),
    /not found/,
  );
  assert.throws(() => parseVerdict("no json"), /not strict JSON/);
  assert.throws(() => parseVerdict('{"top":{}}'), /valid "top" entry/);
});

test("capture builds the documented ffmpeg arguments", () => {
  const input = [
    "-hide_banner",
    "-y",
    "-f",
    "avfoundation",
    "-framerate",
    "30",
    "-video_size",
    "1920x1080",
    "-pixel_format",
    "uyvy422",
    "-i",
    "0:none",
  ];
  assert.deepEqual(captureArgs({ kind: "still", out: "a.jpg" }), [
    ...input,
    "-frames:v",
    "1",
    "-update",
    "1",
    "a.jpg",
  ]);
  assert.deepEqual(captureArgs({ kind: "clip", out: "a.mp4" }), [
    ...input,
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "23",
    "a.mp4",
  ]);
  assert.equal(
    captureArgs({ kind: "clip", out: "a.mp4", seconds: 5 })[13],
    "5",
  );
});

async function fakeFfmpeg(width: number, height: number, exit = 0) {
  const bin = await workDir();
  const image = join(bin, "frame.png");
  await writeFile(image, await renderScene(width, height));
  await writeScript(
    bin,
    "ffmpeg",
    `const a = process.argv.slice(2); require("node:fs").copyFileSync(${JSON.stringify(image)}, a[a.length - 1]); process.exit(${exit});`,
  );
  return bin;
}

test("capture still checks the size and refuses a calibration of another size", async () => {
  const dir = await workDir();
  const out = join(dir, "still.png");
  const good = await fakeFfmpeg(CAPTURE_SIZE.width, CAPTURE_SIZE.height);
  const text = await withPath(good, () => runCaptureCommand(["still", out]));
  assert.match(text, /still=.*size=1920x1080/);
  const clip = await withPath(good, () =>
    runCaptureCommand(["clip", join(dir, "c.mp4"), "--seconds", "2"]),
  );
  assert.match(clip, /clip=/);
  const wrong = await fakeFfmpeg(640, 480);
  await assert.rejects(
    withPath(wrong, () => runCaptureCommand(["still", out])),
    /camera returned 640x480/,
  );
  const { cal } = await calibratedDir();
  await assert.rejects(
    withPath(good, () => runCaptureCommand(["still", out, "--cal", cal])),
    /does not match the calibration capture size 640x480/,
  );
  const failing = await fakeFfmpeg(1, 1, 1);
  await assert.rejects(
    withPath(failing, () => runCaptureCommand(["still", out])),
    /exited with code 1/,
  );
  await assert.rejects(
    withPath(dir, () => runCaptureCommand(["still", out])),
    /ffmpeg was not found/,
  );
});

test("calibrate and capture flags are validated", async () => {
  assert.deepEqual(parseTarget("1872x1404"), { width: 1872, height: 1404 });
  assert.throws(() => parseTarget("1872"), /WxH/);
  assert.throws(() => parseTarget("0x5"), /WxH/);
  assert.equal(parseAspect("4:3"), 4 / 3);
  assert.throws(() => parseAspect("4"), /W:H/);
  assert.equal(parsePanel("dark"), "dark");
  assert.throws(() => parsePanel("grey"), /auto, light, or dark/);
  assert.equal(parsePositive("--x", "5"), 5);
  assert.throws(() => parsePositive("--x", "0"), /positive integer/);
  assert.deepEqual(splitFlags(["a", "--llm", "--out", "b", "-3"]).words, [
    "a",
    "-3",
  ]);
  await assert.rejects(runCalibrate([]), /--image flag is required/);
  await assert.rejects(runCaptureCommand(["photo"]), /capture <still\|clip>/);
  await assert.rejects(
    runCaptureCommand(["still", "x.jpg", "--seconds", "0"]),
    /positive integer/,
  );
  const dir = await workDir();
  const image = await writeScene(dir);
  const out = join(dir, "calibration.json");
  await runCalibrate([
    "--image",
    image,
    "--out",
    out,
    "--target",
    "1600x1200",
    "--aspect",
    "4:3",
    "--panel",
    "light",
  ]);
  assert.deepEqual((await readCalibration(pendingPath(out))).target, {
    width: 1600,
    height: 1200,
  });
  await assert.rejects(
    runCalibrate(["--image", image, "--out", out, "--target", "1920x1080"]),
    /target aspect 1\.7778/,
  );
  const found = detectPanel(
    await loadGray(await renderScene(FRAME.width, FRAME.height)),
    "light",
  );
  assert.equal(
    runChecks({
      corners: SCENE_CORNERS,
      capture: FRAME,
      target: { width: 1872, height: 1404 },
      aspect: 4 / 3,
      edgePoints: found.edgePoints,
    }).length,
    4,
  );
  assert.ok(CalibrationError.name);
});

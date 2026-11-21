import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { parseEventLog } from "../src/video/event-log.ts";
import { readFolderFrames } from "../src/video/folder.ts";
import { readVideoFrames } from "../src/video/ffmpeg.ts";
import { parseVideoArgs, runVideo } from "../src/video/cli-video.ts";
import { VideoInputError } from "../src/video/types.ts";
import { main } from "../src/cli.ts";
import { syntheticImage } from "./synthetic.ts";

async function makeClip(dir: string, name: string): Promise<string> {
  const path = join(dir, name);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=64x48:rate=5",
      "-t",
      "1",
      "-pix_fmt",
      "yuv420p",
      path,
    ]);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)),
    );
  });
  return path;
}

async function makeFolder(names: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "its-folder-"));
  for (const name of names) {
    await writeFile(join(dir, name), await syntheticImage(8, 6, 3));
  }
  return dir;
}

test("an mp4 clip yields five frames with media timestamps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-clip-"));
  const clip = await makeClip(dir, "clip.mp4");
  const result = await readVideoFrames(clip, join(dir, "frames"));
  assert.equal(result.frames.length, 5);
  result.frames.forEach((frame, index) => {
    assert.equal(frame.index, index);
    assert.ok(Math.abs(frame.timestamp - index * 0.2) < 0.001);
    assert.ok(basename(frame.path).endsWith(".png"));
  });
});

test("a mov clip yields five frames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-clip-"));
  const clip = await makeClip(dir, "clip.mov");
  const result = await readVideoFrames(clip, join(dir, "frames"));
  assert.equal(result.frames.length, 5);
});

test("a folder yields frames in numeric order with index timestamps", async () => {
  const dir = await makeFolder(["frame10.png", "frame2.png", "frame1.png"]);
  const result = await readFolderFrames(dir, 1);
  assert.deepEqual(
    result.frames.map((frame) => basename(frame.path)),
    ["frame1.png", "frame2.png", "frame10.png"],
  );
  assert.deepEqual(
    result.frames.map((frame) => frame.timestamp),
    [0, 1, 2],
  );
});

test("a folder timestamp divides the index by the frame rate", async () => {
  const dir = await makeFolder(["a.png", "b.png", "c.png", "notes.txt"]);
  const result = await readFolderFrames(dir, 4);
  assert.deepEqual(
    result.frames.map((frame) => frame.timestamp),
    [0, 0.25, 0.5],
  );
});

test("an empty folder fails with a clear error", async () => {
  const dir = await makeFolder(["notes.txt"]);
  await assert.rejects(readFolderFrames(dir, 1), VideoInputError);
});

test("a missing input fails with a clear error", async () => {
  await assert.rejects(
    runVideo(parseVideoArgs(["/no/such/clip.mp4"])),
    /does not exist/,
  );
});

test("an unsupported video extension fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-clip-"));
  const path = join(dir, "clip.avi");
  await writeFile(path, "x");
  await assert.rejects(
    runVideo(parseVideoArgs([path])),
    /Use an mp4 or mov file/,
  );
});

test("a broken video file fails with a clear error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "its-clip-"));
  const path = join(dir, "bad.mp4");
  await writeFile(path, "not a video");
  await assert.rejects(
    readVideoFrames(path, join(dir, "frames")),
    VideoInputError,
  );
});

test("an event log parses times and optional rectangles", () => {
  const events = parseEventLog(
    JSON.stringify([
      { time: 0.5, rect: { x: 1, y: 2, width: 3, height: 4 } },
      { time: 1 },
    ]),
  );
  assert.deepEqual(events, [
    { time: 0.5, rect: { x: 1, y: 2, width: 3, height: 4 } },
    { time: 1 },
  ]);
});

test("a bad event log fails with a clear error", () => {
  assert.throws(() => parseEventLog("not json"), /not valid JSON/);
  assert.throws(() => parseEventLog("{}"), /must be a JSON array/);
  assert.throws(() => parseEventLog('[{"time":"x"}]'), /"time"/);
  assert.throws(() => parseEventLog('[{"time":-1}]'), /"time"/);
  assert.throws(() => parseEventLog('[{"time":1,"rect":{"x":1}}]'), /"rect"/);
  assert.throws(
    () =>
      parseEventLog('[{"time":1,"rect":{"x":1,"y":1,"width":0,"height":2}}]'),
    /"rect"/,
  );
  assert.throws(() => parseEventLog("[1]"), /must be an object/);
});

test("the video command reports frames and events as JSON", async () => {
  const dir = await makeFolder(["1.png", "2.png"]);
  const log = join(dir, "..", `log-${basename(dir)}.json`);
  await writeFile(log, JSON.stringify([{ time: 1 }]));
  const output = await runVideo(
    parseVideoArgs([dir, "--events", log, "--json"]),
  );
  const report = JSON.parse(output);
  assert.equal(report.source, "folder");
  assert.equal(report.frames.length, 2);
  assert.deepEqual(report.events, [{ time: 1 }]);
});

test("the video command prints plain lines", async () => {
  const dir = await makeFolder(["1.png"]);
  const output = await runVideo(parseVideoArgs([dir]));
  assert.match(output, /^source=folder frames=1\nindex=0 time=0 path=/);
});

test("video argument errors are clear", () => {
  assert.throws(() => parseVideoArgs([]), /path is required/);
  assert.throws(() => parseVideoArgs(["a", "--fps", "0"]), /--fps/);
  assert.throws(() => parseVideoArgs(["a", "--bogus"]), /Unknown flag/);
  assert.throws(() => parseVideoArgs(["a", "--events"]), /needs a value/);
});

test("the CLI exits with 1 and a message for a missing video", async () => {
  const code = await main(["video", "/no/such/clip.mp4"]);
  assert.equal(code, 1);
});

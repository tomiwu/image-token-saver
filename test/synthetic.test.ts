import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import sharp from "sharp";
import { parseGroundTruth } from "../src/video/ground-truth.ts";
import { readFolderFrames } from "../src/video/folder.ts";
import { readVideoFrames } from "../src/video/ffmpeg.ts";
import { parseEventLog } from "../src/video/event-log.ts";
import { parseVideoArgs, runVideo } from "../src/video/cli-video.ts";
import { SCENARIOS, generateAll, type Clip } from "../src/video/synthetic.ts";

let clips: Clip[] = [];

before(async () => {
  clips = await generateAll(await mkdtemp(join(tmpdir(), "its-synth-")));
});

function find(name: string): Clip {
  const clip = clips.find((item) => item.name === name);
  assert.ok(clip, `clip ${name} exists`);
  return clip;
}

async function grey(path: string, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(path)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels];
}

test("the generator makes 4 change clips and 2 still clips", () => {
  const changed = clips.filter((clip) => clip.truth.events.length > 0);
  const still = clips.filter((clip) => clip.truth.events.length === 0);
  assert.equal(changed.length, 4);
  assert.equal(still.length, 2);
  assert.equal(clips.length, SCENARIOS.length);
});

test("a change video has the expected frame count and timestamps", async () => {
  for (const clip of clips) {
    const result = await readVideoFrames(clip.video, join(clip.folder, "out"));
    assert.equal(result.frames.length, clip.truth.frameCount);
    result.frames.forEach((frame, index) => {
      assert.ok(Math.abs(frame.timestamp - index / clip.truth.fps) < 0.001);
    });
  }
});

test("the ground truth lists the seeded events exactly", async () => {
  const clip = find("change-two-panels");
  const truth = parseGroundTruth(await readFile(clip.truthPath, "utf8"));
  assert.deepEqual(truth.events, [
    {
      time: 0.6,
      rect: { x: 4, y: 8, width: 24, height: 20 },
      label: "left-panel-appears",
    },
    {
      time: 1.6,
      rect: { x: 60, y: 36, width: 30, height: 18 },
      label: "right-panel-appears",
    },
  ]);
});

test("a vanishing layer gives an appear and a disappear event", () => {
  const events = find("change-toast").truth.events;
  assert.deepEqual(
    events.map((event) => [event.label, event.time]),
    [
      ["toast-appears", 0.5],
      ["toast-disappears", 1.1],
    ],
  );
});

test("the rectangle changes pixels at the event frame only", async () => {
  const clip = find("change-dialog");
  const inside = { x: 30, y: 20 };
  const before = await grey(
    join(clip.folder, "frame-0004.png"),
    inside.x,
    inside.y,
  );
  const after = await grey(
    join(clip.folder, "frame-0005.png"),
    inside.x,
    inside.y,
  );
  assert.ok(before < 100);
  assert.equal(after, 220);
});

test("a still clip has an empty event list despite noise or flicker", async () => {
  for (const name of ["still-noise-flicker", "still-ghosting"]) {
    const clip = find(name);
    const truth = parseGroundTruth(await readFile(clip.truthPath, "utf8"));
    assert.deepEqual(truth.events, []);
    const first = await sharp(join(clip.folder, "frame-0001.png"))
      .raw()
      .toBuffer();
    const second = await sharp(join(clip.folder, "frame-0002.png"))
      .raw()
      .toBuffer();
    assert.notDeepEqual(first, second);
  }
});

test("the generator is deterministic", async () => {
  const again = await generateAll(await mkdtemp(join(tmpdir(), "its-synth-")));
  const one = await readFile(
    join(find("still-noise-flicker").folder, "frame-0003.png"),
  );
  const two = await readFile(join(again[4].folder, "frame-0003.png"));
  assert.deepEqual(one, two);
});

test("the video command reads a clip and an image folder", async () => {
  const clip = find("change-dialog");
  const fromVideo = await runVideo(
    parseVideoArgs([clip.video, "--json", "--out-dir", join(clip.folder, "v")]),
  );
  assert.equal(JSON.parse(fromVideo).frames.length, 10);
  const fromFolder = await readFolderFrames(clip.folder, clip.truth.fps);
  assert.equal(fromFolder.frames.length, 10);
  assert.equal(fromFolder.frames[4].timestamp, clip.truth.events[0].time);
});

test("the events array of a truth file works as an event log", () => {
  const truth = find("change-dialog").truth;
  const events = parseEventLog(JSON.stringify(truth.events));
  assert.equal(events[0].time, 0.8);
});

test("a bad ground-truth file fails with a clear error", () => {
  assert.throws(() => parseGroundTruth("nope"), /not valid JSON/);
  assert.throws(() => parseGroundTruth("[]"), /version 1/);
  assert.throws(
    () => parseGroundTruth('{"version":1,"events":{}}'),
    /"events"/,
  );
  const base = { version: 1, width: 4, height: 4, fps: 1, frameCount: 2 };
  const parse = (events: unknown) =>
    parseGroundTruth(JSON.stringify({ ...base, events }));
  assert.throws(() => parse([1]), /must be an object/);
  assert.throws(() => parse([{ time: -1 }]), /"time"/);
  assert.throws(
    () =>
      parse([
        { time: 1, label: "", rect: { x: 0, y: 0, width: 1, height: 1 } },
      ]),
    /"label"/,
  );
  assert.throws(() => parse([{ time: 1, label: "a", rect: 1 }]), /"rect"/);
  assert.throws(
    () =>
      parse([
        { time: 1, label: "a", rect: { x: 0, y: 0, width: 0, height: 1 } },
      ]),
    /"width"/,
  );
  assert.throws(
    () => parseGroundTruth(JSON.stringify({ ...base, width: 0, events: [] })),
    /"width"/,
  );
});

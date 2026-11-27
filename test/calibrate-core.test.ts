import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyHomography,
  homographyFromPoints,
  invertHomography,
  solveLinear,
} from "../src/calibrate/homography.ts";
import { distortPoint, undistortPoint } from "../src/calibrate/distortion.ts";
import { detectPanel } from "../src/calibrate/detect.ts";
import { loadGray } from "../src/calibrate/mask.ts";
import { fitLine, intersect, fitQuad } from "../src/calibrate/line-fit.ts";
import { decodeRgb, warpRaw, warpToPng } from "../src/calibrate/warp.ts";
import {
  applyEdgeOffsets,
  parseOffsets,
  scaleOffsets,
} from "../src/calibrate/edge-offsets.ts";
import {
  rectCorners,
  viewSize,
  type Corners,
  type Point,
} from "../src/calibrate/types.ts";
import {
  SCENE_CORNERS,
  renderPaleCabledScene,
  renderScene,
} from "./calibrate-scene.ts";

function near(actual: Point, expected: Point, tolerance: number): void {
  assert.ok(
    Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) <= tolerance,
    `expected ${actual} near ${expected}`,
  );
}

test("homography maps the four source points and inverts", () => {
  const src: Point[] = [
    [0, 0],
    [100, 0],
    [100, 80],
    [0, 80],
  ];
  const dst: Point[] = [
    [10, 5],
    [210, 20],
    [190, 150],
    [0, 120],
  ];
  const h = homographyFromPoints(src, dst);
  src.forEach((p, i) => near(applyHomography(h, p), dst[i], 1e-6));
  const back = invertHomography(h);
  near(applyHomography(back, dst[2]), src[2], 1e-6);
  near(applyHomography(back, applyHomography(h, [33, 41])), [33, 41], 1e-6);
});

test("homography rejects degenerate points and singular systems", () => {
  const line: Point[] = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
  ];
  assert.throws(() => homographyFromPoints(line, line), /degenerate/);
  assert.throws(
    () =>
      solveLinear(
        [
          [0, 0],
          [0, 0],
        ],
        [1, 1],
      ),
    /degenerate/,
  );
  assert.throws(
    () => invertHomography([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    /inverted/,
  );
});

test("distortion round trip and zero k1", () => {
  const size = { width: 640, height: 480 };
  const p: Point = [600, 40];
  assert.deepEqual(undistortPoint(p, 0, size), p);
  assert.deepEqual(distortPoint(p, 0, size), p);
  const back = distortPoint(undistortPoint(p, 0.1, size), 0.1, size);
  near(back, p, 1e-3);
});

test("line fit and intersect", () => {
  const horizontal = fitLine([
    [0, 5],
    [10, 5],
    [20, 5],
  ]);
  const vertical = fitLine([
    [7, 0],
    [7, 9],
    [7, 30],
  ]);
  near(intersect(horizontal, vertical), [7, 5], 1e-9);
  assert.throws(() => intersect(horizontal, horizontal), /parallel/);
});

test("detect finds the corners of a skewed screen", async () => {
  const gray = await loadGray(await renderScene(640, 480));
  const found = detectPanel(gray, "auto");
  for (const name of ["tl", "tr", "br", "bl"] as const) {
    near(found.corners[name], SCENE_CORNERS[name], 2.5);
  }
  assert.equal(found.k1, 0);
  assert.ok(found.fill > 0.9 && found.fill < 1.1);
});

test("detect works with the explicit panel polarity", async () => {
  const gray = await loadGray(await renderScene(640, 480));
  near(detectPanel(gray, "light").corners.tl, SCENE_CORNERS.tl, 2.5);
  assert.throws(() => detectPanel(gray, "dark"), /not found|edge/);
});

test("detect reports a corner outside the frame", async () => {
  const outside: Corners = {
    tl: [60, -40],
    tr: [540, 40],
    br: [520, 420],
    bl: [-30, 380],
  };
  const gray = await loadGray(await renderScene(640, 480, outside));
  const found = detectPanel(gray, "auto");
  near(found.corners.tl, outside.tl, 8);
  near(found.corners.bl, outside.bl, 8);
});

test("detect fails on a blank frame", async () => {
  const blank = Buffer.alloc(64 * 48, 100);
  const gray = { data: blank, width: 64, height: 48 };
  assert.throws(() => detectPanel(gray, "auto"), /not found/);
});

test("detect finds a pale panel against a white wall, bezel and cables", async () => {
  const gray = await loadGray(await renderPaleCabledScene(640, 480));
  const found = detectPanel(gray, "auto");
  for (const name of ["tl", "tr", "br", "bl"] as const) {
    near(found.corners[name], SCENE_CORNERS[name], 4);
  }
  near(detectPanel(gray, "light").corners.tl, SCENE_CORNERS.tl, 4);
});

test("fitQuad needs points on every edge", () => {
  const points: Point[] = Array.from({ length: 20 }, (_, i) => [i, 0]);
  assert.throws(
    () =>
      fitQuad(
        points,
        points.map(() => "top"),
      ),
    /edge/,
  );
});

test("detect keeps k1 at zero for straight edges", async () => {
  const gray = await loadGray(await renderScene(640, 480));
  assert.equal(detectPanel(gray, "light").k1, 0);
});

test("detect picks a k1 when the lens curves the edges", async () => {
  const corners: Corners = {
    tl: [90, 60],
    tr: [550, 60],
    br: [550, 420],
    bl: [90, 420],
  };
  const gray = await loadGray(await renderScene(640, 480, corners, 0.04, 0.12));
  const found = detectPanel(gray, "light");
  assert.ok(found.k1 > 0.05, `k1 was ${found.k1}`);
});

test("warp makes a straight front view", async () => {
  const png = await renderScene(640, 480);
  const geometry = {
    corners: SCENE_CORNERS,
    k1: 0,
    capture: { width: 640, height: 480 },
  };
  const size = viewSize({ width: 1872, height: 1404 }, 448);
  assert.deepEqual(size, { width: 448, height: 336 });
  const raw = warpRaw(await decodeRgb(png), geometry, size);
  const bezelOrWall = new Set([20, 90]);
  let leaked = 0;
  for (let i = 4; i < raw.width - 4; i++) {
    for (const y of [4, raw.height - 5]) {
      leaked += bezelOrWall.has(raw.data[(y * raw.width + i) * 3]) ? 1 : 0;
    }
  }
  assert.ok(leaked < 8, `bezel or wall leaked into ${leaked} edge pixels`);
  const encoded = await warpToPng(png, geometry, size);
  assert.ok(encoded.length > 100);
});

test("edge offsets move an edge inward in front-view pixels", () => {
  const target = { width: 1872, height: 1404 };
  const rect = rectCorners(target);
  const moved = applyEdgeOffsets(rect, target, { right: 10, left: -5 });
  const scale = 1872 / 1092;
  near(moved.tr, [rect.tr[0] - 10 * scale, 0], 1e-6);
  near(moved.tl, [-5 * scale, 0], 1e-6);
  near(moved.br, [rect.br[0] - 10 * scale, rect.br[1]], 1e-6);
});

test("edge offsets map through a skewed quad", () => {
  const target = { width: 1872, height: 1404 };
  const moved = applyEdgeOffsets(SCENE_CORNERS, target, { top: 20 });
  assert.ok(moved.tl[1] > SCENE_CORNERS.tl[1]);
  near(moved.bl, SCENE_CORNERS.bl, 1e-6);
  near(moved.br, SCENE_CORNERS.br, 1e-6);
  assert.throws(
    () => applyEdgeOffsets(SCENE_CORNERS, target, { left: 600, right: 600 }),
    /no screen area/,
  );
});

test("offsets parse and scale", () => {
  assert.deepEqual(parseOffsets(["right", "20", "bottom", "8"]), {
    right: 20,
    bottom: 8,
  });
  assert.deepEqual(parseOffsets(["right", "-10", "right", "4"]), { right: -6 });
  assert.deepEqual(scaleOffsets({ top: 2 }, 3), { top: 6 });
  assert.throws(() => parseOffsets([]), /Use ok/);
  assert.throws(() => parseOffsets(["right"]), /Use ok/);
  assert.throws(() => parseOffsets(["middle", "3"]), /Cannot read/);
  assert.throws(() => parseOffsets(["right", "x"]), /Cannot read/);
});

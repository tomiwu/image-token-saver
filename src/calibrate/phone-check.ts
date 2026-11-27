import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { distortPoint } from "./distortion.ts";
import { warpToPng, type WarpGeometry } from "./warp.ts";
import { CORNER_NAMES, VIEW_WIDTH, viewSize, type Size } from "./types.ts";

export const INSTRUCTION = "Reply OK, or for example 'right -10'";
export const GRID_PX = 100;
const BAND_HEIGHT = 56;

function gridLines(width: number, height: number, step: number): string {
  const lines: string[] = [];
  for (let x = step; x < width; x += step) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`);
  }
  for (let y = step; y < height; y += step) {
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`);
  }
  return `<g stroke="#ff00ff" stroke-opacity="0.45" stroke-width="1">${lines.join("")}</g>`;
}

function svg(size: Size, body: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">${body}</svg>`,
  );
}

function cornerMarks(geometry: WarpGeometry, factor: number): string {
  const shown = CORNER_NAMES.map((name) => {
    const [x, y] = distortPoint(
      geometry.corners[name],
      geometry.k1,
      geometry.capture,
    );
    return { label: name.toUpperCase(), x: x * factor, y: y * factor };
  });
  const outline = shown.map((p) => `${p.x},${p.y}`).join(" ");
  const marks = shown.map(
    (p) =>
      `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#ff2020"/><text x="${p.x + 9}" y="${p.y - 9}" font-size="22" font-family="sans-serif" font-weight="bold" fill="#ff2020" stroke="#ffffff" stroke-width="0.8">${p.label}</text>`,
  );
  return `<polygon points="${outline}" fill="none" stroke="#ff2020" stroke-width="2"/>${marks.join("")}`;
}

export async function renderOverlay(
  source: Uint8Array,
  geometry: WarpGeometry,
  width: number,
): Promise<Buffer> {
  const factor = width / geometry.capture.width;
  const size = viewSize(geometry.capture, width);
  const grid = gridLines(size.width, size.height, GRID_PX * factor);
  const base = await sharp(source)
    .resize(size.width, size.height)
    .removeAlpha()
    .toBuffer();
  return sharp(base)
    .composite([{ input: svg(size, grid + cornerMarks(geometry, factor)) }])
    .png()
    .toBuffer();
}

async function renderFront(
  source: Uint8Array,
  geometry: WarpGeometry,
  target: Size,
): Promise<Buffer> {
  const size = viewSize(target, VIEW_WIDTH);
  const front = await warpToPng(source, geometry, size);
  return sharp(front)
    .composite([
      { input: svg(size, gridLines(size.width, size.height, GRID_PX)) },
    ])
    .png()
    .toBuffer();
}

function instructionBand(): Buffer {
  const size = { width: VIEW_WIDTH, height: BAND_HEIGHT };
  const text = `<rect width="${size.width}" height="${size.height}" fill="#ffffff"/><text x="16" y="38" font-size="28" font-family="sans-serif" fill="#000000">${INSTRUCTION}</text>`;
  return svg(size, text);
}

export async function writePhoneCheck(
  source: Uint8Array,
  geometry: WarpGeometry,
  target: Size,
  path: string,
): Promise<void> {
  const front = await renderFront(source, geometry, target);
  const overlay = await renderOverlay(source, geometry, VIEW_WIDTH);
  const band = await sharp(instructionBand()).png().toBuffer();
  const frontHeight = viewSize(target, VIEW_WIDTH).height;
  const overlayHeight = viewSize(geometry.capture, VIEW_WIDTH).height;
  await mkdir(dirname(path), { recursive: true });
  await sharp({
    create: {
      width: VIEW_WIDTH,
      height: frontHeight + overlayHeight + BAND_HEIGHT,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: front, top: 0, left: 0 },
      { input: overlay, top: frontHeight, left: 0 },
      { input: band, top: frontHeight + overlayHeight, left: 0 },
    ])
    .png()
    .toFile(path);
}

/**
 * Declared crop rectangles and expected bug coverage for the methods eval.
 * Coordinates are in the original 1872×1404 pixel space of buggy-01.png.
 * The images themselves are not in git.
 */

export const SOURCE_SIZE = { width: 1872, height: 1404 };

/** Crop rectangles as CLI --rect values: x,y,w,h (inclusive origin, exclusive end). */
export const CROP_RECTS = {
  "crop-lessons": { x: 700, y: 120, w: 1136, h: 540 },
  "crop-dzis": { x: 0, y: 1240, w: 700, h: 164 },
  "crop-union": { x: 28, y: 120, w: 1808, h: 1284 },
  "crop-payment": { x: 716, y: 930, w: 1120, h: 410 },
};

/** Seeded bugs that are visible inside each variant. */
export const BUGS_INSIDE = {
  full: ["A", "B", "C", "D"],
  0.25: ["A", "B", "C", "D"],
  "crop-lessons": ["B", "C", "D"],
  "crop-dzis": ["A"],
  "crop-union": ["A", "B", "C", "D"],
  "crop-payment": [],
  diff: ["A", "B", "C", "D"],
  greyscale: ["A", "B", "C", "D"],
  "ocr-text": ["B", "D"],
  "no-image": [],
};

export const VARIANT_ORDER = [
  "full",
  "0.25",
  "crop-lessons",
  "crop-dzis",
  "crop-union",
  "crop-payment",
  "diff",
  "greyscale",
  "ocr-text",
  "no-image",
];

export const VARIANT_NOTES = {
  full: "Full-size baseline with the improved prompt.",
  0.25: "Scale 0.25 baseline with the improved prompt.",
  "crop-lessons":
    "Crop of the lesson list. Bugs B, C, and D are inside. Bug A is outside.",
  "crop-dzis":
    "Crop of the Dziś button region. Bug A is inside. Bugs B, C, and D are outside.",
  "crop-union":
    "One crop that covers all four bug areas. The month header is mostly outside.",
  "crop-payment":
    "Realistic crop of the payment card widget. No seeded bug is inside.",
  diff: "Changed region from --method diff against the clean start-panel sample.",
  greyscale: "Full-size greyscale copy. Same width and height as the baseline.",
  "ocr-text":
    "OCR text only. Data bugs B and D can appear in the text. Layout bugs A and C need pixels.",
  "no-image": "Text-only baseline with no image and no OCR text.",
};

export function rectString(rect) {
  return `${rect.x},${rect.y},${rect.w},${rect.h}`;
}

export function bugsLabel(id) {
  const bugs = BUGS_INSIDE[id] || [];
  return bugs.length ? bugs.join(", ") : "none";
}

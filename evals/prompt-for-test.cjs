const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const IMAGE_PROMPT = readFileSync(join(__dirname, "prompt.txt"), "utf8");
const LAYOUT_PROMPT = readFileSync(
  join(__dirname, "prompt-layout.txt"),
  "utf8",
);
const INLINE_LINE = "The screenshot is attached to this message.";
const FILE_LINE = "Screenshot file: {{image}}";

const OCR_INTRO = `The input below is OCR text from a screenshot of an e-ink school calendar. There is no image file.

The calendar is for November 2026. The Polish name of the month is Listopad.

The left part of the screen has a month grid. The weekday letters are P W Ś C P S N. The dates are 1 to 30. A button with the label Dziś is at the bottom of the left part.

The right part of the screen has a list of school lessons. Each lesson has a start time and an end time. Below the list there is a payment card with a QR code. There are also pager controls.

The circled date is 10. This is the selected day. Do not report the selected day as a bug.

The letter M in a black square is a lesson mark. It is not a weekday error.

The date on the payment card can be different from the selected day. This difference is not a bug.

The pager text "1/2 · +2 więcej" is usual for this user interface. Do not report this text as a bug unless the text is clipped, or the text overlaps another item, or the text contains a typo.

Grey weekend dates are usual for this user interface. A small icon below a date is usual for this user interface.

A valid time uses the 24-hour format. A valid time is between 00:00 and 23:59.

Polish labels can use Polish letters (for example ł, ś, and ń).

The OCR process can introduce errors. Do not report a usual OCR letter error as a bug, unless the text shows a clear data defect. Examples of data defects: a time that is not valid (for example 25:00), or a duplicated lesson row.

Report only defects in layout or in data that you can detect from this text. Examples of defects: a time is not valid, a row is a duplicate, or a label has a typo that is clearly wrong. You cannot confirm a layout defect (for example a widget that is off the edge, or text that is clipped at a box edge) from OCR text alone. Do not invent layout defects.

Do not report a usual design choice. Do not report an alignment preference. Do not report that the selected day is not the date of this evaluation.

Write a numbered list. For each bug, give one short location (the area of the screen or the lesson row). If there is no bug, write NONE.

OCR text:
`;

const NO_IMAGE_PROMPT =
  "There is no screenshot and no OCR text. Reply with the word PONG only.";

function readOcrText(vars) {
  if (typeof vars.ocr_text === "string" && vars.ocr_text.trim()) {
    return vars.ocr_text;
  }
  if (typeof vars.ocr_path === "string" && vars.ocr_path.trim()) {
    return readFileSync(vars.ocr_path, "utf8");
  }
  return "";
}

function imagePrompt(vars) {
  const inline = vars?.delivery === "inline";
  if (vars?.prompt_kind === "layout") {
    const tail = inline ? INLINE_LINE : `Screenshot file: ${vars?.image || ""}`;
    return `${LAYOUT_PROMPT}${tail}\n`;
  }
  const body = inline
    ? IMAGE_PROMPT.replace(FILE_LINE, INLINE_LINE)
    : IMAGE_PROMPT;
  return body.replaceAll("{{image}}", vars?.image || "");
}

module.exports = async ({ vars } = {}) => {
  const kind = vars?.input_kind || "image";
  if (kind === "none") {
    return NO_IMAGE_PROMPT;
  }
  if (kind === "ocr") {
    return `${OCR_INTRO}${readOcrText(vars)}`;
  }
  return imagePrompt(vars);
};

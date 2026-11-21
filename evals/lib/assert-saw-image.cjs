module.exports = async (output, context) => {
  const { assertSawImage, scoreOutput } = await import("./score.mjs");
  const kind = context?.vars?.input_kind || "image";
  const text = String(output || "").trim();
  if (kind === "none") {
    const pass = /^pong$/i.test(text);
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass
        ? "No-image baseline replied with PONG"
        : `No-image baseline did not reply with PONG: ${text.slice(0, 80)}`,
    };
  }
  if (kind === "ocr") {
    const pass = text.length > 0;
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass
        ? "OCR variant produced an answer"
        : "OCR variant produced no answer",
    };
  }
  const expected = String(context?.vars?.expect_bugs || "");
  if (expected === "none") {
    const score = scoreOutput(text);
    const pass = score.sawImage || /^\s*none\b/i.test(text);
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass
        ? "Region crop produced NONE or described the region"
        : "Region crop produced no usable answer",
    };
  }
  return assertSawImage(output);
};

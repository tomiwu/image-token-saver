module.exports = async (output) => {
  const { assertSawImage } = await import("./score.mjs");
  return assertSawImage(output);
};

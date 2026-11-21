module.exports = async (output) => {
  const { assertFalsePositives } = await import("./score.mjs");
  return assertFalsePositives(output);
};

module.exports = async (output) => {
  const { assertBug } = await import("./score.mjs");
  return assertBug(output, "b");
};

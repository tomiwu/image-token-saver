module.exports = async () => {
  const { buildTests, parseRuns } = await import("./lib/plan.mjs");
  const imageDir = process.env.EVALS_IMAGE_DIR;
  if (!imageDir) {
    throw new Error("EVALS_IMAGE_DIR is not set");
  }
  return buildTests(imageDir, parseRuns(process.env.EVALS_RUNS));
};

module.exports = async (output, context) => {
  const { assertCase } = await import("./assert-case.mjs");
  return assertCase(output, context?.vars?.case_id, context?.config?.metric);
};

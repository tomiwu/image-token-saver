import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "coverage/", "node_modules/", ".sandcastle/worktrees/"],
  },
  {
    files: ["evals/**/*.mjs", "evals/**/*.js", "evals/**/*.cjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        module: "writable",
        exports: "writable",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
  {
    files: ["evals/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["evals/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);

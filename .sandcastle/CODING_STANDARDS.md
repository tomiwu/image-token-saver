# Coding Standards

These rules apply to image-token-saver. The reviewer loads this file. Prefer `docs/CODING_STANDARDS.md` when it exists.

## Language and style

- Write TypeScript as ESM (`"type": "module"`). Use TypeScript 7.0.2.
- Use the official `@modelcontextprotocol/sdk` 1.32.2 and `sharp` 0.35.5 when those packages are in scope.
- Target Node.js 24.22.3. Do not add a second implementation language.
- Prefer clear names and small functions. Avoid nested ternaries.
- Do not leave commented-out code or TODO comments.
- Write comments, docs and commit messages in English, in ASD-STE100 Simplified Technical English: short sentences, active voice, one instruction in each sentence.

## Errors

- Do not swallow errors. Return a typed result or throw only at a documented edge.
- Do not log image pixels, file paths of local sample renders, or secrets.

## Testing

- Use the Node.js built-in `node:test` runner. Do not add another test framework.
- Tests must use in-memory or synthetic fixtures only. Do not commit local sample renders or personal screenshots.
- CI and tests must not call a paid vendor API.

## Product rules

- The reducer must stay deterministic. Do not put an LLM inside the reducer.
- Token estimates must follow official vendor formulas documented in `research/01-vendor-token-rules.md` when that file exists. Do not invent vendor figures.
- Do not commit `.sandcastle/.env` or other secrets.

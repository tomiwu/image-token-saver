# Rules for coding agents

- Run `scripts/precommit.sh` before each commit. It runs format, lint, typecheck, tests, and the CRAP gate. Fix all failures first.
- Write code, comments, docs, and commit messages in English. Use ASD-STE100 Simplified Technical English.
- Use ESM TypeScript 7.0.2, Node.js 24.22.3, and `sharp` 0.35.5. The current interface is the CLI. Do not add an MCP server in this MVP.
- Tests use `node:test`. Write a failing test first.
- Keep the reducer deterministic. Do not put an LLM inside it.
- Do not commit secrets, `.sandcastle/.env`, or local sample renders.
- Do not leave commented-out code or TODO comments.
- Read `docs/PRD.md` before you change behaviour.

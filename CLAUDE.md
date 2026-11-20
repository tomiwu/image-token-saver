# Rules for coding agents

- Run `scripts/precommit.sh` before each commit. It runs format, lint, typecheck, and tests. Fix all failures first.
- Write code, comments, docs, and commit messages in English. Use ASD-STE100 Simplified Technical English.
- Use ESM TypeScript 7.0.2, Node.js 24.22.3, `@modelcontextprotocol/sdk` 1.32.2, and `sharp` 0.35.5.
- Tests use `node:test`. Write a failing test first.
- Keep the reducer deterministic. Do not put an LLM inside it.
- Do not commit secrets, `.sandcastle/.env`, or local sample renders.
- Do not leave commented-out code or TODO comments.
- Read `docs/PRD.md` before you change behaviour.

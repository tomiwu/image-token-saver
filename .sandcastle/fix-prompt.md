# Task

You work on image-token-saver, issue #{{ISSUE}}, branch `{{BRANCH}}`. The checks failed (local checks or GitHub Actions CI). Fix the code so that all checks pass. When CI exists, the workflow jobs are `format`, `lint`, `typecheck` and `test`. Do not skip a CI step when a file is missing.

## Check output

```
{{CHECK_LOG}}
```

# Rules

- Find the cause of each failure. Fix the cause. Do not remove or weaken tests to make them pass.
- Follow `docs/PRD.md`, `docs/CODING_STANDARDS.md` (when it exists) and `.sandcastle/CODING_STANDARDS.md`.
- Keep version pins: TypeScript 7.0.2, Node.js 24.22.3, `@modelcontextprotocol/sdk` 1.32.2, `sharp` 0.35.5, Prettier 3.10.1, ESLint 10.15.0.
- The reducer must stay deterministic. Do not put an LLM inside the reducer.
- Do not invent vendor token figures.
- Do not commit secrets, `.sandcastle/.env`, or local sample renders.
- If the format check fails, run the project formatter (Prettier). Do not format files by hand. Then run the format check again.
- Run `scripts/precommit.sh` when it exists.
- Make one commit. Start the message with `RALPH: #{{ISSUE}} fix`. Write it in English, in ASD-STE100 Simplified Technical English.
- Do not push. Do not open a PR. Do not close the issue. Do not merge.

When you are done, output:

<promise>COMPLETE</promise>

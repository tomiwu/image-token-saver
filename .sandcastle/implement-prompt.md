# Context

You work on image-token-saver. It is a deterministic image reducer. It has no LLM inside the reducer. It runs as a local MCP server (stdio). The public repository is https://github.com/tomiwu/image-token-saver (MIT licence).

## Your issue: #{{ISSUE}}

!`gh issue view {{ISSUE}} --json number,title,body,comments --jq '{number, title, body, comments: [.comments[].body]}'`

## Recent commits

!`git log --oneline -10`

# Task

Implement issue #{{ISSUE}} on branch `{{BRANCH}}`. Do only this issue.

1. Read the issue. Read `docs/PRD.md` when it exists. Follow the PRD. Follow `docs/CODING_STANDARDS.md` when it exists.
2. Read the source files and tests that exist.
3. Use Red-Green-Refactor when you add or change behaviour. Write a failing test first. Then write the code that makes the test pass. For a skeleton or documentation issue, add the requested files. Prefer a `scripts/precommit.sh` that is safe to hook now.
4. If the tools exist, run `scripts/precommit.sh`. If that script is only a stub, follow its message. Fix all failures that belong to this issue.
5. Make one git commit. Start the message with `RALPH: #{{ISSUE}}`. Write the task, the key decisions and the files changed. Write the message in English, in ASD-STE100 Simplified Technical English. The host copies the commit messages into the PR description.

# Rules

- Write all code, comments and commit messages in English. Use ASD-STE100 Simplified Technical English: short sentences, active voice, one instruction in each sentence.
- Keep these version pins: TypeScript `7.0.2`, Node.js `24.22.3`, `@modelcontextprotocol/sdk` `1.32.2`, `sharp` `0.35.5`. Use Prettier `3.10.1` and ESLint `10.15.0` when you add those tools. The module format is ESM (`"type": "module"`). Tests use `node:test`.
- Do not push. Do not open a PR. Do not close the issue. Do not merge. The host does the push and the PR after the checks pass.
- Do not edit `docs/PRD.md` except when this issue explicitly asks you to add or update that file. Do not edit `.sandcastle/` except `.sandcastle/.gitignore` if this issue requires it.
- You can edit `.github/workflows/ci.yml` when the issue is about CI. Keep job ids `format`, `lint`, `typecheck` and `test`. Do not skip a CI step when a file is missing.
- The reducer must stay deterministic. Do not put an LLM inside the reducer.
- Do not commit secrets, `.sandcastle/.env`, or local sample renders. Do not write paths of local sample renders into the repository.
- Do not invent vendor token figures. Use official formulas only.
- Do not leave commented-out code or TODO comments.
- If you cannot continue, write a comment on the issue with `gh issue comment {{ISSUE}}`. Explain the problem.

When you are done, output:

<promise>COMPLETE</promise>

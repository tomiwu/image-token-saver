# TASK

Review the code changes on branch `{{BRANCH}}` and improve code clarity, consistency, and maintainability while preserving exact functionality.

# CONTEXT

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. **Understand the change**: Read the diff and commits above to understand the intent.

2. **Analyze for improvements**: Look for opportunities to:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve readability through clear variable and function names
   - Consolidate related logic
   - Remove unnecessary comments that describe obvious code
   - Avoid nested ternary operators
   - Choose clarity over brevity

3. **Check correctness**:
   - Does the implementation match the issue and `docs/PRD.md` (when it exists)?
   - Are new or changed behaviours covered by tests (`node:test`)?
   - Are secrets, `.sandcastle/.env`, or local sample renders absent from the commit?
   - Does the change invent vendor token figures? Reject that. Official formulas only.
   - Does the change put an LLM inside the reducer? Reject that.

4. **Maintain balance**: Avoid over-simplification that reduces clarity or hides concerns.

5. **Apply project standards**: Follow the coding standards in @.sandcastle/CODING_STANDARDS.md and in `docs/CODING_STANDARDS.md` (when it exists). `docs/CODING_STANDARDS.md` has priority.

6. **Preserve functionality**: Never change what the code does — only how it does it, unless you fix a standards violation.

# RULES

- Write TypeScript as ESM. Use TypeScript 7.0.2, Node.js 24.22.3, `@modelcontextprotocol/sdk` 1.32.2 and `sharp` 0.35.5 when those packages are in scope.
- Tests use `node:test`. Do not add another test framework.
- Do not push. Do not open a PR. Do not close the issue. Do not merge.
- Do not edit `docs/PRD.md` or `.sandcastle/` except to fix a standards violation that this review must correct.
- Do not commit secrets or local sample renders.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch.
2. Run `scripts/precommit.sh` when it exists and is executable.
3. Commit the refinements. Start the message with a short description. Write the commit message in English, in ASD-STE100 Simplified Technical English.

If the code is already clean and well-structured, do nothing.

Once complete, output <promise>COMPLETE</promise>.

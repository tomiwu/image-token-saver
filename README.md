# image-token-saver

`image-token-saver` is a deterministic image reducer. It has no LLM inside the reducer. It runs as a local MCP server on stdio. An agent calls it before the agent sends an image to a vision model. The tool reduces the input image tokens.

## Licence

This project uses the MIT licence. See `LICENSE`.

## Versions

- Node.js 24.22.3
- TypeScript 7.0.2
- `@modelcontextprotocol/sdk` 1.32.2
- `sharp` 0.35.5

The project is ESM. Tests use `node:test`.

## How to run (later issues)

The library and the MCP server come in later issues. When they exist, you will start the server with one command on stdio. This README will show that command.

Run the local checks before each commit:

```sh
scripts/precommit.sh
```

## Sample renders

Local sample renders are not committed. The `.gitignore` file ignores the local sample directories. Tests use synthetic fixtures only.

## Documents

- `docs/PRD.md`: product requirements.
- `docs/overview.md`: project overview.
- `GLOSSARY.md`: terms.
- `CLAUDE.md`: rules for coding agents.

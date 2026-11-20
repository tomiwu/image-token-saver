# image-token-saver

`image-token-saver` is a deterministic image reducer. It has no LLM inside the reducer. The first testable interface is a local CLI. You run it by hand on an image. The tool prints official-formula token counts before and after a reduction. An MCP server is postponed.

## Licence

This project uses the MIT licence. See `LICENSE`.

## Versions

- Node.js 24.22.3
- TypeScript 7.0.2
- `sharp` 0.35.5

The project is ESM. Tests use `node:test`.

## How to run

Install the dependencies once, then use the `image-token-saver` command (or `node src/cli.ts`).

```sh
npm install
```

### Commands

```sh
image-token-saver estimate <in> --model <claude|gpt-4o|gpt-5.2|gemini> [--json]
image-token-saver reduce <in> --model <claude|gpt-4o|gpt-5.2|gemini> [--method resize|crop|palette|mask|diff] [--rect x,y,w,h] [--prev <file>] --out <file> [--json]
```

The short model names map to the library models: `claude` is `claude-standard`, `gemini` is `gemini-3`. The default method for `reduce` is `resize`. The `crop` and `mask` methods need `--rect x,y,w,h`. The `diff` method needs `--prev <file>`.

Each run prints the official formula that produced the estimate, and the token counts before and after. Add `--json` for a JSON object.

Run the local checks before each commit:

```sh
scripts/precommit.sh
```

## Examples

Use a local image that is not committed. Replace `./photo.png` with your path.

Estimate the official tokens for Claude:

```sh
node src/cli.ts estimate ./photo.png --model claude
```

Resize the image to the official Claude processed size and write the result:

```sh
node src/cli.ts reduce ./photo.png --model claude --method resize --out ./photo.claude.png
```

Apply a 16-colour palette for Gemini and print JSON:

```sh
node src/cli.ts reduce ./photo.png --model gemini --method palette --out ./photo.palette.png --json
```

## Sample renders

Local sample renders are not committed. The `.gitignore` file ignores the local sample directories. Tests use synthetic fixtures only.

## Documents

- `docs/PRD.md`: product requirements.
- `docs/overview.md`: project overview.
- `GLOSSARY.md`: terms.
- `CLAUDE.md`: rules for coding agents.

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
image-token-saver reduce <in> --model <claude|gpt-4o|gpt-5.2|gemini> [--method resize|crop|palette|mask|diff] [--scale <0..1>] [--max-side <px>] [--rect x,y,w,h] [--prev <file>] --out <file> [--json]
```

The short model names map to the library models: `claude` is `claude-standard`, `gemini` is `gemini-3`. The default method for `reduce` is `resize`. The `crop` and `mask` methods need `--rect x,y,w,h`. The `diff` method needs `--prev <file>`.

`tokens_before` is the official charge after the vendor's own auto-resize, not the raw pixel count. Claude standard downscales a large image itself, so a raw 1872×1404 frame costs 1564 tokens, not 3417.

The default `resize` writes half of the vendor's own target size, so the official formula can record a real saving when the formula depends on size. Use `--scale <0..1>` to scale the original image (0.5 is a 2× downscale). Use `--max-side <px>` to cap the long edge. If you set both, the CLI applies `--scale` first, then the cap.

Each run prints the official formula, the token counts before and after, and `saved=` in tokens and percent. For GPT-4o, tokens follow 512 px tiles, so a shrink does not always change the count. For Gemini 3, `media_resolution` does not change with pixel size. Add `--json` for a JSON object.

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

Resize the image with the default (half of the vendor target size) and write the result:

```sh
node src/cli.ts reduce ./photo.png --model claude --method resize --out ./photo.claude.png
```

Downscale to half of the original size (the 2× path in the formula baseline):

```sh
node src/cli.ts reduce ./photo.png --model gpt-5.2 --method resize --scale 0.5 --out ./photo.gpt52.png
```

## Sample renders

Local sample renders are not committed. The `.gitignore` file ignores the local sample directories. Tests use synthetic fixtures only.

## Documents

- `docs/PRD.md`: product requirements.
- `docs/overview.md`: project overview.
- `GLOSSARY.md`: terms.
- `CLAUDE.md`: rules for coding agents.

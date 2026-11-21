# Screenshot bug eval

This folder is a [promptfoo](https://github.com/promptfoo/promptfoo) eval. The eval asks a subscription CLI to list bugs in a seeded calendar screenshot. The scores use deterministic javascript checks against `evals/answer-key.md`. The prompt describes the usual user interface. The prompt asks for a numbered list of layout defects and data defects only. Each item must include a short location.

The eval is **not** part of CI or `scripts/precommit.sh`. It needs the Claude Code and Cursor CLI logins on the machine.

## Uncommitted images

The source start-panel PNG is a local sample and must not be committed. The derived eval images are also kept out of git, under a directory you choose:

```sh
export EVALS_IMAGE_DIR=/workspace/image-tokens/evals
```

`npm run eval` uses that path when the variable is unset, but you should set it explicitly on other machines.

Expected files in `$EVALS_IMAGE_DIR`:

- `buggy-01.png` — 1872×1404 image with the four seeded bugs
- `buggy-01-key.png` — marked copy with boxes and a legend
- `answer-key.md` — the same text as `evals/answer-key.md`
- `scales/full.png` — copy of the full-size buggy image
- `scales/scale-0.75.png`, `scale-0.5.png`, `scale-0.34.png`, `scale-0.25.png`
- `scales/max-side-512.png` — `--max-side 512` (512×384)

Build the scales with the MVP CLI from this branch, from the directory of the checkout:

```sh
IN="$EVALS_IMAGE_DIR/buggy-01.png"
node src/cli.ts reduce "$IN" --model claude --scale 0.75 --out "$EVALS_IMAGE_DIR/scales/scale-0.75.png"
node src/cli.ts reduce "$IN" --model claude --scale 0.5 --out "$EVALS_IMAGE_DIR/scales/scale-0.5.png"
node src/cli.ts reduce "$IN" --model claude --scale 0.34 --out "$EVALS_IMAGE_DIR/scales/scale-0.34.png"
node src/cli.ts reduce "$IN" --model claude --scale 0.25 --out "$EVALS_IMAGE_DIR/scales/scale-0.25.png"
node src/cli.ts reduce "$IN" --model claude --max-side 512 --out "$EVALS_IMAGE_DIR/scales/max-side-512.png"
```

Formula token estimates in the promptfoo test vars were measured with `node src/cli.ts estimate` on those files. Do not invent replacement numbers.

## Run

```sh
export EVALS_IMAGE_DIR=/workspace/image-tokens/evals
npm run eval
```

That command:

1. Resolves the image paths into `$EVALS_IMAGE_DIR/promptfooconfig.resolved.yaml`
2. Runs `npx promptfoo@0.126.0 eval` with concurrency 1 and `repeat` 1
3. Writes `$EVALS_IMAGE_DIR/results.json` and `$EVALS_IMAGE_DIR/results.html`
4. Builds `$EVALS_IMAGE_DIR/REPORT.md`, `$EVALS_IMAGE_DIR/results-table.html`, and `$EVALS_IMAGE_DIR/summary.png` from `results.json`

If Cursor CLI (`agent`) is not logged in, run only Claude Code:

```sh
EVALS_PROVIDERS=claude-code npm run eval
```

After `agent login`, omit `EVALS_PROVIDERS` to run every model.

Raise repeats without editing the default:

```sh
EVALS_REPEAT=2 npm run eval
```

Raw answers are reused from `$EVALS_IMAGE_DIR/raw/` when present, so a second run does not spend the subscription budget again. Force a new call with `EVALS_FORCE_RERUN=1`.

## Providers

The provider is a promptfoo **JavaScript** provider (`evals/providers/cli-provider.mjs`), not `exec:`. Official promptfoo docs state that an `exec:` provider treats stdout as the answer text and cannot fill `tokenUsage`. The JavaScript provider wraps:

- `claude -p --output-format json` (Claude Code OAuth)
- `agent -p --model <id> --mode ask --output-format json` (Cursor CLI)

No API keys are used. Cursor cloud agents are not used.

Default models:

- `claude-code` — Claude Code default model
- `grok-4.7-high`
- `gpt-5.2`
- `gemini-3.1-pro`
- `composer-2.5`

If a CLI cannot take an image, drop that provider from the config and record it in the report. The runner does not invent token counts. When the CLI JSON includes usage, the report labels it **measured**. Otherwise it uses the official-formula estimate from this repo’s CLI, labelled **estimate**, and only for Claude, GPT-4o, GPT-5.2, and Gemini 3. Grok and Composer have no formula in this CLI.

## Assertions

Each seeded bug is a named javascript assert (`bug-a` … `bug-d`), plus `saw-image` and `false-positives`. The score is bugs found out of 4. An optional `llm-rubric` grader is documented in the config and is off by default so it does not spend extra subscription calls.

Scorer unit tests (no subscriptions):

```sh
node --test evals/lib/score.test.mjs
```

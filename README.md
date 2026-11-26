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

## Video command

`image-token-saver video <file.mp4|file.mov|folder> [--events <log.json>] [--out-dir <dir>] [--fps <n>] [--json]`

The command needs ffmpeg 7 on PATH for video files. It writes each frame as a PNG and lists the frames with timestamps.

- **Video file:** the timestamp is the media timestamp (`pts_time`) in seconds.
- **Folder:** the command sorts image file names in natural order (`frame2` before `frame10`). The timestamp is the sequence index divided by `--fps`. The default is 1 frame per second.
- **Event log:** a JSON array such as `[{"time": 0.5, "rect": {"x": 0, "y": 0, "width": 10, "height": 10}}]`. `time` is in seconds. `rect` is optional. The command parses the log as a hint only.

## Synthetic clips and ground truth

`node scripts/make-synthetic-clips.ts <out-dir>` writes 6 clips. Each clip has an mp4 file, a folder of PNG frames, and a `<name>.truth.json` file. Tests make the clips at run time. Do not commit the clips.

- **Change clips (4):** `change-dialog`, `change-two-panels`, `change-toast`, `change-noisy-badge`. Each change has an exact time and rectangle.
- **Still clips (2):** `still-noise-flicker` and `still-ghosting`. They have noise, flicker, or ghosting. Their event list is empty.

The ground-truth file is JSON:

```json
{
  "version": 1,
  "width": 96,
  "height": 64,
  "fps": 5,
  "frameCount": 10,
  "events": [
    {
      "time": 0.8,
      "rect": { "x": 20, "y": 12, "width": 40, "height": 30 },
      "label": "dialog-opens-appears"
    }
  ]
}
```

- **Units:** `time` is in seconds from the start of the clip. It equals the frame index divided by `fps`. `width`, `height`, and all `rect` values are in pixels. `rect` has its origin at the top-left corner of the frame.
- **label:** a short, non-empty name for the change.
- **Event log:** the `events` array works as an `--events` log for the `video` command.

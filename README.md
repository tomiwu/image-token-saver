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

## Calibrate command (perspective correction)

A fixed camera sees the screen under test from the side. The `calibrate` command finds the 4 inner screen corners in one frame. It checks them and saves `calibration.json`. The `estimate`, `reduce` and `video` commands then use `--cal calibration.json` to warp each image or frame to a straight front view before they do other steps.

### Install on macOS

The command needs only Node.js and ffmpeg. It has no Python or OpenCV sidecar. The corner search, the line fit, the homography and the warp are TypeScript on top of `sharp`.

```sh
brew install node@24 ffmpeg
npm install
```

The optional `--llm` step needs the `claude` CLI (Claude Code) on PATH. The default flow does not need it.

### Steps

1. Take one frame at the capture size. Use the `capture` helper or any tool that gives 1920×1080.
2. Run `image-token-saver calibrate --image frame.jpg`. The default target is 1872×1404 (4:3). Use `--target WxH` and `--aspect W:H` for other screens. Use `--panel light|dark` when the automatic choice picks the wrong region.
3. The command writes `phone-check.png` (width 1092 px) and a draft `calibration.pending.json`. It prints both paths and the instruction `Reply OK, or for example 'right -10'`. The command does not wait for input.
4. Look at `phone-check.png`. The top part is the warped front view. The bottom part is the capture with the corners TL, TR, BR, BL and a 100 px grid.
5. Apply your reply later, in any shell:

```sh
image-token-saver calibrate adjust ok
image-token-saver calibrate adjust right -10
image-token-saver calibrate adjust right 20 bottom 8
```

Offsets are in pixels of the 1092 px wide front view. A positive value moves that edge inward (crops more). A negative value moves it outward (includes more). `adjust ok` writes `calibration.json`. An `adjust` with offsets runs the checks again, and writes `calibration.json` and a new `phone-check.png` only when all checks pass. Use `--cal <path>` when `calibration.json` is not in the current folder. The draft and the phone check sit next to that file.

### Checks

The command exits with code 1 and does not write `calibration.json` when a check fails.

- Each corner is inside the frame. The allowed overflow N is 12 px. The message names the corner and the overflow, for example `corner TL is 63.0 px outside the frame (limit 12 px)`.
- The quad is convex.
- The target aspect equals the wanted aspect (4:3 by default).
- The warped edges are straight: the angle offset is at most 1° and the line residual is at most 2 px in the 1092 px wide front view.

The corner search looks at the whole frame. It does not use a window from an earlier pose. It thresholds the frame, takes the largest panel region, fits one line to each edge with RANSAC and least squares, and intersects the lines. It can find a corner outside the frame when the edges are partly visible. A lens term k1 is kept only when it lowers the residual by at least 0.05 px.

### Optional LLM refine

`--llm` runs the `claude -p` route (the same CLI as the eval). It sends a small front view and an overlay and asks for a JSON answer for each side. The command makes at most 2 calls. After the first call a code check looks at the edge strips of the new front view. The command stops early when all sides are clean. It runs the fixed checks after each round and reverts a round that fails. `calibration.json` keeps each round under `llm_refine` with the measured token use from the CLI. The command does not invent token numbers. A call costs about 12,000 tokens on the prototype. `--llm-width` sets the width of the image that the model sees (default 448).

### Use the calibration

```sh
image-token-saver estimate frame.jpg --model claude --cal calibration.json
image-token-saver reduce frame.jpg --model claude --cal calibration.json --width 448 --out front.png
image-token-saver video clip.mp4 --cal calibration.json --out-dir frames
```

`--width` sets the width of the warped image. The height follows the target aspect. The default is 448 (448×336 at 4:3). On 2026-11-26 this size scored 100% on 19 fixed facts in both repeats and costs 192 formula tokens on Claude. A size of 384×288 is not reliable in colour. A size of 256×192 shows the layout only. The commands refuse an input when its size is not the capture size in `calibration.json`. `video --cal` writes the warped frames to `<out-dir>/warped`.

### Capture on macOS

```sh
image-token-saver capture still calib.jpg
image-token-saver capture clip test.mp4 --seconds 3 --cal calibration.json
```

The helper runs ffmpeg with avfoundation. Stills and clips use the same input settings:

```sh
ffmpeg -hide_banner -y -f avfoundation -framerate 30 -video_size 1920x1080 -pixel_format uyvy422 -i "0:none"
```

A still adds `-frames:v 1 -update 1 <out.jpg>`. A clip adds `-t 3 -c:v libx264 -pix_fmt yuv420p -crf 23 <out.mp4>`. The photos and the video for one `calibration.json` must all have the same size. Pass `--cal` to refuse a capture when the calibration has another size. On a Logitech C920 a request for 30 fps can fall back to about 5.36 fps. The size stays 1920×1080.

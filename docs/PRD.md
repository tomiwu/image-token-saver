# PRD: image-token-saver

**Status:** Approved draft for issue #1. The public repository exists: https://github.com/tomiwu/image-token-saver (MIT licence, default branch `main`, one initial commit). This document has not yet been committed to the repository.

**Date:** 20 November 2026 (Europe/Warsaw).

**Language:** English, ASD-STE100 Simplified Technical English.

**Phase:** Phase 0 checks are recorded. Phase 1 decisions are recorded below. The repository exists. Local drafts are being turned into GitHub issues. This phase does not push code, does not set branch protection, and does not start a Sandcastle loop.

## 1. Goal

`image-token-saver` is a deterministic image reducer. It has no LLM inside the reducer. It runs as a local MCP server (stdio) on the maintainer's computer. Grok Bot, Cursor, and Claude Code can call it before they send an image to a vision model. The tool must reduce input image tokens. The maintainer checks quality.

## 2. Users

- the maintainer, when he runs Grok Bot, Cursor, or Claude Code with UI screenshots, e-ink renders, or photos.
- A local agent that attaches many screenshots in a loop and must pay fewer image tokens.

## 3. Scope

**In scope:**

- A local library that reads an image and an optional previous frame, plus a target model.
- A local MCP server on stdio that wraps the library.
- Methods: resize to each model's best processed size; region-of-interest crop; a low-resolution mask on a full-resolution image (Google Meet background-blur style); greyscale and palette reduction; a diff against the previous frame (send the changed region only); text instead of pixels (OCR, a DOM or accessibility tree, or SVG) when that path uses fewer tokens.
- A picker that selects the method with the lowest estimated tokens for the target model.
- Token estimates from official formulas for Claude, GPT, and Gemini. Optional exact Claude counts through the free `count_tokens` endpoint when an API key is present. Usage counters for Grok and Cursor when a formula is not published.
- Automated tests with invented or synthetic fixtures in the repository. Quality checks by the maintainer use local sample renders that are not committed.

**Out of scope (non-goals):**

- An LLM inside the reducer.
- A hosted cloud service.
- Cursor cloud agents for implementation.
- Commit of personal or production screenshots, or of local sample renders.
- Branch protection and the Sandcastle loop in this issue-creation step.

## 4. Decisions (veto allowed)

1. **Repository name.** `image-token-saver`. The public repository exists: https://github.com/tomiwu/image-token-saver. A private repo named `img` (updated 10 December 2024, empty description) is not this project.
2. **Visibility and licence.** **Public**, licence **MIT**. This is a generic tool, like `crap4s`. The repository must not contain personal screenshots or credentials. Write the licence in the README.
3. **Owner bot.** One owner bot for this repository. Other bots do not touch the repo without a written hand-over.
4. **Implementation stack.** **TypeScript 7.0.2** + official **`@modelcontextprotocol/sdk` 1.32.2** + **`sharp` 0.35.5**. Runtime: **Node.js 24.22.3** (newest 24 LTS patch as of 10 November 2026). Oldest supported runtime for CI release tests: **Node.js 24**. Reasons:
   - The official MCP SDK is a first-class Node package (`engines`: Node `>=18`).
   - `sharp` uses libvips. This matches the agreed "ImageMagick/libvips-like" requirement. ImageMagick and the `vips` CLI were not installed on the box at the decision date.
   - Existing Sandcastle images already use Node 22 Bookworm. The box already runs Node v24.22.1 (LTS codename Krypton).
   - The Python alternative (Python 3.13, `mcp` 2.3.0, Pillow 13.0.0, `pyvips` 3.2.0) is viable, but `mcp` was not installed on the box, and `vips` was absent, so `pyvips` cannot run without a new system library.
   - Newest Active LTS is Node.js 26.13.1 (10 November 2026). Disk space on the box is tight. Another process is freeing disk. Do not build a new container image and do not delete images. Default is Node 24 until there is enough disk to add Node 26 to CI. the maintainer can veto this and require Node 26.
5. **Module format.** ESM TypeScript. Exact test library: Node.js built-in `node:test` (no extra test framework).
6. **MCP transport.** stdio only in the first release. HTTP is out of scope.
7. **Picker goal.** There is no fixed token target. The picker must minimise estimated tokens for the named model, then return the reduced image or the text substitute.
8. **Quality gate.** Automated tests check dimensions, lossless invariants where they apply, and token estimates. the maintainer checks visual quality. Issues that need his eye get the `needs-validation` label.
9. **Samples.** Local sample renders stay on the box and are not committed. Repository tests use synthetic fixtures with no personal data.
10. **Claude measurement.** Use official `count_tokens` when `ANTHROPIC_API_KEY` is present. Do not block the reducer on a key. Formula estimates always work offline.

## 5. Test decisions

1. CI must not call a paid vendor API. CI uses official formulas and in-memory fake images only.
2. Synthetic fixtures in the repo: 1280×800, 1920×1080, 1872×1404 (4:3 e-ink shape), and 4032×3024, in greyscale and in RGB. Use generated patterns, not production screenshots.
3. Golden tests compare token estimates to the official formulas documented in `research/01-vendor-token-rules.md`.
4. File-size tests may assert that a 4-bit greyscale encode can change bytes. They must not assert that colour depth changes formula tokens.
5. Local quality review by the maintainer uses local sample renders that are not committed. Do not write those paths into the repository.
6. MCP tests spawn the server on stdio and call tools with a tiny generated PNG.
7. There is no `hardware` label in the first issues. The MCP server runs on a computer, not on a device.

## 6. Functional requirements

1. Accept an image (file path or raw bytes), a target model identifier, and an optional previous frame.
2. Estimate tokens for the current image on the target model with the official formula, when one exists.
3. Apply each enabled method that is valid for that request.
4. Pick the result with the lowest estimated tokens. If two results have the same token estimate, pick the one that keeps more pixels in the region of interest, then the one with the smaller byte size.
5. Return the reduced image bytes or the text substitute, the method name, the estimated tokens before and after, and the output size.
6. Do not send the image to an LLM inside this tool.

## 7. Limits (CHECK-LIMITS)

- **Disk:** On 20 November 2026 the box root filesystem had about 3.5 GiB free of 128 GiB. Existing Sandcastle images are 3.8–7.7 GiB. Another process is freeing disk. Do not build a new image. Do not delete images. Do not run `podman reset`.
- **GitHub token:** The process `GH_TOKEN` is invalid. The `tomiwu` `gh` login works with `env -u GH_TOKEN gh ...` and has scopes `gist`, `read:org`, `repo`, `user`, `workflow`. It can list the repository and create issues. It does not provide a fine-grained PAT for this repo with Contents, Issues, Pull requests, Workflows, and Administration. Branch protection setup needs that PAT.
- **Anthropic API key:** `ANTHROPIC_API_KEY` was absent in the process environment at the check date. A `CLAUDE_CODE_OAUTH_TOKEN` may be present for other work (values are not recorded here). Official `count_tokens` documentation uses an API key. Exact Claude counts stay blocked until a suitable key is provided through a masked field.
- **Other vendor keys:** Formula baselines do not need paid OpenAI, Gemini, or xAI keys. Those keys were absent at the check date.
- **Kody:** The Kody fetch limit is 2500 fetches per week (project blueprint). This tool does not need Kody in the first release.
- **Cron:** Any later monitor routine must use UTC.
- **Grok Bot / Cursor usage:** Plan limits exist. The first release must log estimate counts. It must not call paid APIs from CI.
- **MCP / agent hosts:** The server runs on the maintainer's computer over stdio. It does not open a public port.

## 8. Access (CHECK-ACCESS)

- Drafts and research may live on the shared box under a project workspace directory. They are not all in the Git repository yet.
- The later local clone on the maintainer's computer follows the standing project path under `yolo_ideas/image-token-saver`.
- The MCP server must run on the maintainer's own computer, not only on the box, so that Cursor, Claude Code, and Grok Bot on that computer can start it.
- Secret values must not be written into this file or into issues.

## 9. Legal (CHECK-LEGAL)

- Public repo, MIT licence, for original code in this project.
- `@modelcontextprotocol/sdk`, TypeScript, and `sharp` are third-party packages. Record their licences in a NOTICE or README. `sharp` depends on libvips. Confirm the libvips licence text at packaging time.
- Official vendor token formulas come from published documentation. The tool may implement those formulas. It must not scrape unofficial mirrors.
- Local sample renders stay on the box. They are not published in the public repo.
- The tool must not log image pixels to a remote service.

## 10. Facts found (CHECK-FACTS)

- The public repository https://github.com/tomiwu/image-token-saver exists (created 20 November 2026, 15:12 Europe/Warsaw). Licence: MIT. Default branch: `main`. One initial commit.
- `gh` for issue work must use `env -u GH_TOKEN gh ...`.
- Podman 5.4.2 is present. Sandcastle images for other projects and `docker.io/library/node:22-bookworm` exist on the box. Do not delete them.
- Reference project: public repo `tomiwu/crap4s`, folder `.sandcastle/` (Containerfile, `.env.example`, prompts, `main.mts`, `.gitignore`).
- Start-script pattern from other projects: `flock` + pidfile + `setsid nohup` + a unique `/workspace/<project>-loopN.log`. A more complete pattern includes a doctor step, log redaction, and log mode 600.
- `.sandcastle/.env.example` keys in reference projects: `CURSOR_API_KEY`, `GH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`.

## 11. Open items (do not stop other work)

1. **Fine-grained GitHub PAT** for `tomiwu/image-token-saver` with Contents, Issues, Pull requests, Workflows, and Administration, read/write. Store it only in `.sandcastle/.env`. Action: ASK-SECRET. Needed before branch protection and before the Sandcastle loop.
2. **Anthropic API key** for free `count_tokens` measurement. Recommended: a development key with a low spend cap. Do not use a Claude Code OAuth token for `count_tokens` until official documentation says that this works. Action: ASK-SECRET.
3. **Disk space.** Another process is freeing disk. Do not build an image and do not delete images until the maintainer or the disk work says the box is ready.
4. **Node 24 vs Node 26.** Default: Node 24.22.3 now, Node 26 later. Veto if the maintainer wants Node 26 immediately.

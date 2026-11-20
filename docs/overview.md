# Overview

`image-token-saver` reduces the tokens that an image uses in a vision model. The reducer is deterministic. It does not call an LLM.

## Flow

1. The caller gives an image, a target model, and an optional previous frame.
2. The reducer estimates the tokens with the official formula for the model.
3. The reducer applies each valid method.
4. The picker selects the result with the lowest estimated tokens.
5. The tool returns the reduced image or the text substitute, the method name, the tokens before and after, and the output size.

## Parts

- A local library.
- A local CLI that wraps the library. An MCP server on stdio is postponed.

## Rules

- CI does not call a paid vendor API.
- The repository holds no personal screenshots and no local sample renders.
- The tool does not send pixels to a remote service.

See `docs/PRD.md` for the full requirements.

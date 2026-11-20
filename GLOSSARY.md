# Glossary

- **Reducer:** The deterministic code that makes an image use fewer tokens. It has no LLM.
- **Method:** One way to reduce an image. Examples: resize, crop, mask, greyscale, diff, text substitute.
- **Picker:** The code that selects the method with the lowest estimated tokens.
- **Target model:** The vision model that will read the image.
- **Region of interest (ROI):** The part of the image that must keep its detail.
- **Previous frame:** The image that the agent sent before. The diff method uses it.
- **Text substitute:** Text (OCR, DOM tree, accessibility tree, or SVG) that replaces the pixels.
- **Token estimate:** A token count from an official vendor formula.
- **CLI:** The current command-line interface. You run `image-token-saver` by hand to estimate or reduce an image.
- **MCP:** Model Context Protocol. An MCP server is postponed. It is out of scope for the current MVP.
- **Sample render:** A local image for quality checks. It is never committed.
- **Synthetic fixture:** A generated test image in the repository. It has no personal data.

# Method variants for the buggy-01 eval

This file records the crop rectangles and the expected bug coverage. The images themselves are not in git. Build them with:

```sh
export EVALS_IMAGE_DIR=/workspace/image-tokens/evals
export EVALS_SAMPLE=/workspace/image-tokens/samples/00-start-panel.png
node evals/prepare-variants.mjs
```

Coordinates are in the original 1872×1404 pixel space of `buggy-01.png`. The CLI flag is `--rect x,y,w,h`.

## Clean reference

The clean previous frame for `--method diff --prev` is a copy of the original start-panel sample. The buggy image was made from that sample by adding the four seeded bugs. This process is deterministic. If the original sample is not on the machine, do not invent a clean image.

## Crops

| Variant      | Rect (x,y,w,h)   | Size      | Bugs inside | Notes                                                                                                                                                          |
| ------------ | ---------------- | --------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| crop-lessons | 700,120,1136,540 | 1136×540  | B, C, D     | Lesson list. Bug A is outside.                                                                                                                                 |
| crop-dzis    | 0,1240,700,164   | 700×164   | A           | Dziś button region. Bugs B, C, and D are outside.                                                                                                              |
| crop-union   | 28,120,1808,1284 | 1808×1284 | A, B, C, D  | One crop that covers all bug areas. The month header is mostly outside. Official standard tokens stay close to the full image, because the bugs sit far apart. |
| crop-payment | 716,930,1120,410 | 1120×410  | none        | Realistic crop of the payment card. A found count of 0 is correct.                                                                                             |

## Diff

`reduce --method diff --prev clean.png` writes the changed-region crop. On this pair the crop is 1524×1258 (origin 28,146). All four seeded bugs are inside that box. Official standard tokens stay close to the full image, because the bounding box of the four bugs is still large.

## Greyscale

A full-size 1872×1404 greyscale copy, made with the same sharp pipeline as `greyscaleMethod`. The official formula uses size, not colour, so the formula count stays 1564. The eval measures the Claude usage to test that claim.

## OCR text

The eval sends column OCR from Tesseract 5 with `pol+eng` language data:

- Left calendar panel, page-segmentation mode 6
- Lesson list crop, page-segmentation mode 4
- Payment card crop, page-segmentation mode 6

A single full-page mode 4 pass mixed the two columns and missed the time 25:00. The column text includes 25:00 and two Matematyka rows, so data bugs B and D can appear in the text. Layout bugs A and C need pixels.

## Structured source

No layout JSON or data JSON is available in the existing sample sources. Those sources are PNG files only. That variant is not part of the run.

## No-image baseline

A short prompt with no image and no OCR text. The model must reply with the word PONG only. This call measures the fixed CLI cost.

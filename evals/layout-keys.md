# Answer keys for the layout images and the clean image

Write each key before the first model run. The images are made by `evals/prepare-layouts.mjs` from `evals/lib/layouts.mjs`. They are 1280×800 and they stay under `$EVALS_IMAGE_DIR/layouts/`. They do not come from the e1003 samples.

An item that matches no seeded bug is a false positive.

## clean — negative case

`$EVALS_IMAGE_DIR/clean.png` is the clean start-panel sample. The sample has zero seeded bugs. The correct answer is `NONE`. Each listed item is a false positive. The official score is 0 found and 0 false positives.

## layout-form — settings form

- A: The label “Email” overlaps its input box.
- B: The button label has a typo: “Svae” instead of “Save”.
- C: The label “Receive product updates by email and in the app” is clipped at the right edge of the card.

## layout-table — invoice table

- A: The row “INV-1003” (2026-03-16, Cedar, 2 310.00) is listed twice.
- B: The date “2026-13-45” is not valid (month 13).
- C: The “Total” column is clipped at the right edge of the table.

## layout-chat — message list

- A: A message time is “27:15”, which is not a valid time.
- B: The last message bubble extends beyond the right edge of the screen.
- C: Two avatars overlap each other.

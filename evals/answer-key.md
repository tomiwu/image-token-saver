# Answer key for buggy-01

The eval image is a copy of the local November 2026 e-ink calendar start panel (1872×1404). The source sample and the derived PNG files are not in git. They live under `$EVALS_IMAGE_DIR` (see `evals/README.md`).

Coordinates below are in the original 1872×1404 pixel space of `buggy-01.png`. Each bug is intentional and should be unambiguous to a human looking at the full-size image. Other UI details (for example the payment date, the weekday letter on the lesson badge, or the icon under day 14) are **not** in the key. Treat them as false positives if a model reports them as bugs.

## A — large: Dziś button shifted off the bottom edge

The Dziś button originally occupied x=28–651, y=1284–1379. It was moved down by 70 px to y=1354–1450. The lower half of the button, including the lower half of the word “Dziś”, is cut off by the bottom edge of the screen. The original button slot is empty white space.

## B — medium: duplicated event row

The fourth lesson row (y=512–641) is an exact copy of the second row: “2. Matematyka” at 09:00–09:45. The original fourth lesson, “4. Język polski” at 11:00–11:45, is gone.

## C — small: lesson title clipped mid-letter

The title “3. Edukacja wczesnoszkolna” is clipped at x=1460, through the letter “k”. The visible text is “3. Edukacja wczesnoszk” plus a sliced remnant of “k”. The letters “olna” are missing.

## D — tiny: invalid time typo 25:00

The start time of the first lesson (“1. Wychowanie fizyczne”) is 25:00 instead of 08:00. The end time is still 08:45. 25:00 is not a valid clock time.

A marked copy with boxes and a legend is `$EVALS_IMAGE_DIR/buggy-01-key.png` (not committed).

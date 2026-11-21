import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBug, assertFalsePositives, scoreOutput } from "./score.mjs";

const ALL_FOUR = `
1. The Dziś button at the bottom is cut off by the bottom edge of the screen.
2. Matematyka is duplicated: lesson 2 appears twice with the same 09:00–09:45 times.
3. The title Edukacja wczesnoszkolna is clipped mid-letter.
4. The first lesson starts at 25:00, which is not a valid time.
`;

test("scores all four seeded bugs and no false positives", () => {
  const result = scoreOutput(ALL_FOUR);
  assert.deepEqual(result.found, { a: true, b: true, c: true, d: true });
  assert.equal(result.foundCount, 4);
  assert.equal(result.falsePositives, 0);
  assert.equal(result.sawImage, true);
});

test("accepts Polish paraphrases", () => {
  const text = `
1. Przycisk Dziś jest ucięty na dole ekranu.
2. Zdublowana pozycja Matematyka.
3. Tekst Edukacja wczesnoszkolna jest przycięty.
4. Godzina 25:00 jest niepoprawna.
`;
  const result = scoreOutput(text);
  assert.equal(result.foundCount, 4);
  assert.equal(result.falsePositives, 0);
});

test("does not credit a clip mention without the matching widget", () => {
  const onlyTitle = "1. Edukacja wczesnoszkolna is cut off at the box edge.";
  assert.equal(assertBug(onlyTitle, "a").pass, false);
  assert.equal(assertBug(onlyTitle, "c").pass, true);
});

test("maps a missing Język polski row to bug B", () => {
  const text = "4. Język polski is missing and was replaced by Matematyka.";
  assert.equal(assertBug(text, "b").pass, true);
});

test("counts unrelated claims as false positives", () => {
  const text = `
1. The first lesson starts at 25:00.
2. The payment date is 9 November while today is the 10th.
`;
  const result = scoreOutput(text);
  assert.equal(result.found.d, true);
  assert.equal(result.falsePositives, 1);
  assert.equal(assertFalsePositives(text).pass, false);
});

test("NONE is zero found and zero false positives", () => {
  const result = scoreOutput("NONE");
  assert.equal(result.foundCount, 0);
  assert.equal(result.falsePositives, 0);
});

test("credits a cropped Today/Dzień button as bug A", () => {
  const text =
    '6. The "Dzień" ("Today") button at the bottom left is cut off by the bottom edge of the screen.';
  assert.equal(assertBug(text, "a").pass, true);
});

test("credits 'repeats the second entry Matematyka' as bug B", () => {
  const text =
    '3. The last entry comes after 10:00. It also repeats the second entry, "2. Matematyka" at 09:00–09:45.';
  assert.equal(assertBug(text, "b").pass, true);
});

test("credits an earlier end time on the first lesson as bug D", () => {
  const text =
    "4. Lesson list, row 1: the end time (08:45) is earlier than the start time, though this follows from the invalid start time in item 1.";
  assert.equal(assertBug(text, "d").pass, true);
  assert.equal(assertFalsePositives(text).pass, true);
});

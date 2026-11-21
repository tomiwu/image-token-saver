/**
 * Deterministic scorer for the four seeded bugs in buggy-01.
 * Returns yes/no for A–D plus a false-positive count.
 */

const BUG_A = "a";
const BUG_B = "b";
const BUG_C = "c";
const BUG_D = "d";

function normalize(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function has(text, pattern) {
  return pattern.test(text);
}

function mentionsDzis(text) {
  return has(
    text,
    /\bdzis\b|\bdzi[sś]\b|\bdzie[nń]\b|today.{0,12}button|button.{0,40}today|\bprzycisk\s+dzi/,
  );
}

function mentionsCutoff(text) {
  return has(
    text,
    /cut\s*off|clipped|clipping|cropped|truncated|cut by|off the (?:bottom|edge|screen|frame|canvas)|hanging off|overflow(?:s|ing)?|off-screen|off the (?:ui|panel)|beyond the (?:bottom|edge|screen)|bottom of the (?:screen|image|frame|ui|panel|display)|obci[eę]t|uciet|ucięt|przyci[eę]t|przesuni[eę]t|wystaje|poza (?:ekran|krawęd|krawed)/,
  );
}

function mentionsMatematyka(text) {
  return has(text, /matematyka|\bmath(?:ematics)?\b/);
}

function mentionsDuplicate(text) {
  return has(
    text,
    /duplicat|\brepeats?\b|twice|two identical|same (?:lesson|event|row|entry|item) twice|appears twice|listed twice|shown twice|copy of|copied|duplikat|zdublow|powt[oó]rz|dwa razy|dwukrotnie|identical (?:lesson|row|entry|event)/,
  );
}

function mentionsJezykMissing(text) {
  return (
    has(text, /j[eę]zyk polski|polish (?:language|class|lesson)/) &&
    has(
      text,
      /missing|gone|replaced|removed|disappear|overwritten|no longer|zast[aą]p|usun|brak|znikn/,
    )
  );
}

function mentionsEdukacja(text) {
  return has(
    text,
    /edukacja|wczesnoszkolna|wczesnoszk|early(?:[- ]childhood)? education|third lesson|lesson 3|3\.\s*edukacja/,
  );
}

function mentionsTimeTypo(text) {
  return has(
    text,
    /25\s*[:.]\s*00|25\s*00(?!\s*pln)|godzina 25|time 25|starts at 25|25 hundred/,
  );
}

export function foundBugA(text) {
  const n = normalize(text);
  return mentionsDzis(n) && mentionsCutoff(n);
}

export function foundBugB(text) {
  const n = normalize(text);
  return (
    mentionsMatematyka(n) && (mentionsDuplicate(n) || mentionsJezykMissing(n))
  );
}

export function foundBugC(text) {
  const n = normalize(text);
  return mentionsEdukacja(n) && mentionsCutoff(n);
}

function mentionsEndBeforeStart(text) {
  return has(
    text,
    /end time.{0,60}(?:earlier|before).{0,40}start|start time.{0,60}(?:later|after).{0,40}end/,
  );
}

export function foundBugD(text) {
  const n = normalize(text);
  if (mentionsTimeTypo(n)) {
    return true;
  }
  return mentionsEndBeforeStart(n) && /row 1|first lesson|08:45/.test(n);
}

const CHECKS = {
  [BUG_A]: foundBugA,
  [BUG_B]: foundBugB,
  [BUG_C]: foundBugC,
  [BUG_D]: foundBugD,
};

export function splitItems(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return [];
  }
  const n = normalize(raw);
  if (/^\s*none\b/.test(n) && raw.length < 80) {
    return [];
  }
  if (/^\s*pong\s*$/.test(n)) {
    return [];
  }
  const lines = raw
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const decimal = lines.filter((line) => /^\s*\d+[.)]\s+/.test(line));
  if (decimal.length >= 1) {
    return decimal;
  }
  const bullets = lines.filter((line) =>
    /^\s*(?:[-*•]|[a-d][.)])\s+/.test(line),
  );
  if (bullets.length >= 1) {
    return bullets;
  }
  return [raw];
}

function itemMapped(item) {
  return (
    foundBugA(item) || foundBugB(item) || foundBugC(item) || foundBugD(item)
  );
}

export function falsePositiveItems(text) {
  return splitItems(text).filter((item) => !itemMapped(item));
}

export function describesCalendar(text) {
  const n = normalize(text);
  return has(
    n,
    /listopad|november|calendar|kalendarz|matematyka|wychowanie|edukacja|dzis|dzi[sś]|qr|szkola muzyczna|czesne|e-?ink|lekcj/,
  );
}

export function sawImage(text) {
  const n = normalize(text);
  const denied = has(
    n,
    /cannot (?:see|open|access|read|view|find) (?:the )?(?:image|screenshot|file)|no image|unable to (?:see|open|view|load) (?:the )?(?:image|screenshot)|image (?:is )?(?:missing|not (?:provided|attached|available))/,
  );
  if (
    denied &&
    !describesCalendar(n) &&
    !foundBugA(text) &&
    !foundBugB(text) &&
    !foundBugC(text) &&
    !foundBugD(text)
  ) {
    return false;
  }
  return (
    describesCalendar(n) ||
    foundBugA(text) ||
    foundBugB(text) ||
    foundBugC(text) ||
    foundBugD(text)
  );
}

export function scoreOutput(text) {
  const found = {
    a: foundBugA(text),
    b: foundBugB(text),
    c: foundBugC(text),
    d: foundBugD(text),
  };
  const fps = falsePositiveItems(text);
  const foundCount =
    Number(found.a) + Number(found.b) + Number(found.c) + Number(found.d);
  return {
    found,
    foundCount,
    total: 4,
    falsePositives: fps.length,
    falsePositiveItems: fps,
    sawImage: sawImage(text),
  };
}

export function assertBug(output, bug) {
  const check = CHECKS[bug];
  if (!check) {
    return { pass: false, score: 0, reason: `Unknown bug id ${bug}` };
  }
  const pass = check(output);
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Found bug ${bug.toUpperCase()}`
      : `Did not find bug ${bug.toUpperCase()}`,
  };
}

export function assertFalsePositives(output) {
  const fps = falsePositiveItems(output);
  const pass = fps.length === 0;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? "No false-positive items"
      : `${fps.length} false-positive item(s): ${fps.join(" | ")}`,
  };
}

export function assertSawImage(output) {
  const pass = sawImage(output);
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? "The answer describes the screenshot"
      : "The answer does not show that the model received the image",
  };
}

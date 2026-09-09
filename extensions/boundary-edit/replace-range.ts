interface RangeSelectors {
  start: string;
  end: string;
}

interface RangeReplacement extends RangeSelectors {
  replacement: string;
}

type Rejection = "before-start" | "incomplete-line" | "excludes-start";

interface Candidate {
  at: number;
  reason?: Rejection;
}

/** Diagnostics retain bounded locations and label counts from stopped searches. */
export class BoundaryError extends Error {
  constructor(
    readonly selector: "start" | "end",
    readonly kind: "empty" | "missing" | "ambiguous" | "ineligible",
    readonly anchor: string,
    readonly matchCount = 0,
    readonly candidates: Candidate[] = [],
    readonly startAt?: number,
    readonly countExact = true,
  ) {
    super(`${selector} selector: ${kind}`);
  }
}

function* occurrences(text: string, anchor: string, from = 0): Generator<number, void> {
  for (let at = text.indexOf(anchor, from); at !== -1; at = text.indexOf(anchor, at + 1)) {
    yield at;
  }
}

/** A match must end before a complete terminator, after one, or at EOF. */
function endingAt(text: string, afterMatch: number) {
  if (text[afterMatch - 1] === "\n") {
    return {
      to: afterMatch,
      terminator: text[afterMatch - 2] === "\r" ? "\r\n" : "\n",
    };
  }
  if (text.startsWith("\r\n", afterMatch)) {
    return { to: afterMatch + 2, terminator: "\r\n" };
  }
  if (text[afterMatch] === "\n" && text[afterMatch - 1] !== "\r") {
    return { to: afterMatch + 1, terminator: "\n" };
  }
  if (afterMatch === text.length) return { to: afterMatch, terminator: "" };
  return undefined;
}

export function lineNumber(text: string, offset: number): number {
  let line = 1;
  for (const at of occurrences(text, "\n")) {
    if (at >= offset) break;
    line++;
  }
  return line;
}

export function blockStats(text: string) {
  return {
    lines: text.length ? lineNumber(text, text.length) - Number(text.endsWith("\n")) : 0,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

/** Resolve literal selectors against current editable text (the adapter owns the BOM). */
export function resolveRange(text: string, { start, end }: RangeSelectors) {
  if (!start.length) throw new BoundaryError("start", "empty", start);

  const starts: Candidate[] = [];
  let startCount = 0;
  for (const at of occurrences(text, start)) {
    startCount++;
    if (starts.length < 5) starts.push({ at });
    else break;
  }
  const startAt = starts[0]?.at;
  if (startAt === undefined) throw new BoundaryError("start", "missing", start);
  if (startCount > 1) {
    throw new BoundaryError(
      "start",
      "ambiguous",
      start,
      startCount,
      starts,
      undefined,
      startCount <= 5,
    );
  }
  if (!end.length) throw new BoundaryError("end", "empty", end, 0, [], startAt);
  const from = startAt === 0 ? 0 : text.lastIndexOf("\n", startAt - 1) + 1;

  let selectedEnd: ReturnType<typeof endingAt>;
  let eligibleCount = 0;
  let literalCount = 0;
  const eligible: Candidate[] = [];
  const rejected: Record<Rejection, Candidate[]> = {
    "before-start": [],
    "incomplete-line": [],
    "excludes-start": [],
  };
  for (const endAt of occurrences(text, end)) {
    literalCount++;
    const candidate = endingAt(text, endAt + end.length);
    const reason =
      endAt < from
        ? "before-start"
        : !candidate
          ? "incomplete-line"
          : candidate.to < startAt + start.length
            ? "excludes-start"
            : undefined;
    if (reason) {
      // Preserve examples of every rejection kind rather than letting earlier
      // occurrences hide a different eligibility problem later in the file.
      if (rejected[reason].length < 2) rejected[reason].push({ at: endAt, reason });
      continue;
    }
    eligibleCount++;
    if (eligible.length < 5) eligible.push({ at: endAt });
    else break;
    selectedEnd = candidate;
  }
  if (eligibleCount > 1) {
    throw new BoundaryError(
      "end",
      "ambiguous",
      end,
      eligibleCount,
      eligible,
      startAt,
      eligibleCount <= 5,
    );
  }
  if (!selectedEnd) {
    throw new BoundaryError(
      "end",
      literalCount ? "ineligible" : "missing",
      end,
      literalCount,
      Object.values(rejected)
        .flat()
        .sort((a, b) => a.at - b.at),
      startAt,
    );
  }

  const { to, terminator } = selectedEnd;
  return {
    from,
    to,
    terminator,
    startLine: lineNumber(text, from),
    endLine: lineNumber(text, to - terminator.length),
  };
}

export function replaceRange(text: string, { replacement, ...selectors }: RangeReplacement) {
  const range = resolveRange(text, selectors);
  const inserted =
    replacement && !replacement.endsWith("\n") ? replacement + range.terminator : replacement;
  return {
    ...range,
    selected: blockStats(text.slice(range.from, range.to)),
    replacement: blockStats(inserted),
    text: text.slice(0, range.from) + inserted + text.slice(range.to),
  };
}

export interface Endpoint {
  text: string;
  side: "before" | "after";
}

interface RangeSelectors {
  start: Endpoint;
  end: Endpoint;
}

interface RangeReplacement extends RangeSelectors {
  replacement: string;
}

/** Diagnostics retain bounded locations and label counts from stopped searches. */
export class BoundaryError extends Error {
  constructor(
    readonly selector: "start" | "end",
    readonly kind: "empty" | "missing" | "ambiguous" | "reversed" | "invalid UTF-8",
    readonly anchor: string,
    readonly matchCount = 0,
    readonly candidates: { at: number }[] = [],
    readonly startAt?: number,
    readonly countExact = true,
  ) {
    super(`${selector} selector: ${kind}`);
  }
}

function* occurrences(text: string, anchor: string): Generator<number, void> {
  for (let at = text.indexOf(anchor); at !== -1; at = text.indexOf(anchor, at + 1)) yield at;
}

function lineNumber(text: string, offset: number): number {
  let line = 1;
  for (const at of occurrences(text, "\n")) {
    if (at >= offset) break;
    line++;
  }
  return line;
}

export function location(text: string, at: number) {
  const from = at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
  return {
    line: lineNumber(text, at),
    column: [...text.slice(from, at)].length + 1,
    offset: at - from,
  };
}

export function blockStats(text: string) {
  return {
    lines: text.length ? lineNumber(text, text.length) - Number(text.endsWith("\n")) : 0,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function resolveEndpoint(
  text: string,
  endpoint: Endpoint,
  selector: "start" | "end",
  startAt?: number,
) {
  const anchor = endpoint.text;
  if (!anchor.length) throw new BoundaryError(selector, "empty", anchor, 0, [], startAt);
  if (Buffer.from(anchor, "utf8").toString("utf8") !== anchor) {
    throw new BoundaryError(selector, "invalid UTF-8", anchor, 0, [], startAt);
  }
  const candidates: { at: number }[] = [];
  let count = 0;
  for (const at of occurrences(text, anchor)) {
    count++;
    if (candidates.length < 5) candidates.push({ at });
    else break;
  }
  const at = candidates[0]?.at;
  if (at === undefined) throw new BoundaryError(selector, "missing", anchor, 0, [], startAt);
  if (count > 1) {
    throw new BoundaryError(selector, "ambiguous", anchor, count, candidates, startAt, count <= 5);
  }
  return at + (endpoint.side === "after" ? anchor.length : 0);
}

/** Resolve exact half-open positions in editable text (the adapter owns the BOM). */
export function resolveRange(text: string, { start, end }: RangeSelectors) {
  const from = resolveEndpoint(text, start, "start");
  const to = resolveEndpoint(text, end, "end", from);
  if (to < from) {
    throw new BoundaryError(
      "end",
      "reversed",
      end.text,
      1,
      [{ at: to - (end.side === "after" ? end.text.length : 0) }],
      from,
    );
  }
  return { from, to, start: location(text, from), end: location(text, to) };
}

/** Resolve each selector independently so one bad range does not hide the others. */
export function resolveRanges(text: string, ranges: RangeSelectors[]) {
  return ranges.map((selectors) => {
    try {
      return { range: resolveRange(text, selectors) };
    } catch (error) {
      if (!(error instanceof BoundaryError)) throw error;
      return { error };
    }
  });
}

/** Validate the entire original-file batch before building the replacement text. */
export function replaceRanges(text: string, edits: RangeReplacement[]) {
  const resolved = resolveRanges(text, edits);
  const errors: { index: number; error: Error }[] = [];
  const entries = resolved.flatMap((result, index) => {
    const edit = edits[index];
    if (!edit) throw new Error("Missing edit");
    if (result.error) errors.push({ index, error: result.error });
    if (Buffer.from(edit.replacement, "utf8").toString("utf8") !== edit.replacement) {
      errors.push({
        index,
        error: new Error(
          "Replacement must be losslessly representable as UTF-8 (no unpaired surrogates).",
        ),
      });
    }
    return result.range ? [{ index, ...result.range, inserted: edit.replacement }] : [];
  });
  const sorted = [...entries].sort((a, b) => a.from - b.from || a.to - b.to);
  let previous: (typeof sorted)[number] | undefined;
  let insertion: (typeof sorted)[number] | undefined;
  for (const entry of sorted) {
    // Adjacent regions and insertions at edges are independent. Duplicate
    // insertion points are rejected rather than imposing an array-order policy.
    const conflict =
      entry.from === entry.to && insertion?.from === entry.from
        ? insertion
        : previous && entry.from < previous.to
          ? previous
          : undefined;
    if (conflict) {
      errors.push({
        index: entry.index,
        error: new Error(
          `Replacement region overlaps edit ${conflict.index + 1}. Merge the edits or choose disjoint regions; shared context anchors are allowed.`,
        ),
      });
    }
    if (entry.from === entry.to) insertion = entry;
    if (!previous || entry.to > previous.to) previous = entry;
  }
  if (errors.length) return { errors };

  let cursor = 0;
  const parts: string[] = [];
  for (const entry of sorted) {
    parts.push(text.slice(cursor, entry.from), entry.inserted);
    cursor = entry.to;
  }
  parts.push(text.slice(cursor));
  return {
    text: parts.join(""),
    entries: entries.map(({ inserted, ...entry }) => ({
      ...entry,
      selected: blockStats(text.slice(entry.from, entry.to)),
      replacement: blockStats(inserted),
      outcome:
        text.slice(entry.from, entry.to) === inserted
          ? ("unchanged" as const)
          : inserted === ""
            ? ("deleted" as const)
            : ("replaced" as const),
    })),
  };
}

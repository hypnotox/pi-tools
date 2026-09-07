interface RangeReplacement {
  start: string;
  end: string;
  replacement: string;
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

function lineNumber(text: string, offset: number): number {
  let line = 1;
  for (const at of occurrences(text, "\n")) {
    if (at >= offset) break;
    line++;
  }
  return line;
}

/** Resolve literal selectors against current editable text (the adapter owns the BOM). */
export function replaceRange(text: string, { start, end, replacement }: RangeReplacement) {
  if (!start.length) throw new Error("Start selector must be nonempty.");
  if (!end.length) throw new Error("End selector must be nonempty.");

  const starts = occurrences(text, start);
  const firstStart = starts.next();
  if (firstStart.done) throw new Error("Start selector was not found exactly.");
  const startAt = firstStart.value;
  if (!starts.next().done) throw new Error("Start selector is ambiguous in the current file.");
  const from = startAt === 0 ? 0 : text.lastIndexOf("\n", startAt - 1) + 1;

  let selectedEnd: ReturnType<typeof endingAt>;
  for (const endAt of occurrences(text, end, from)) {
    const candidate = endingAt(text, endAt + end.length);
    if (!candidate || candidate.to < startAt + start.length) continue;
    if (selectedEnd) throw new Error("End selector is ambiguous after the selected starting line.");
    selectedEnd = candidate;
  }
  if (!selectedEnd) {
    throw new Error(
      "End selector has no eligible exact match: it must finish at a complete line boundary or EOF and select the entire start anchor.",
    );
  }

  const { to, terminator } = selectedEnd;
  const inserted =
    replacement && !replacement.endsWith("\n") ? replacement + terminator : replacement;
  return {
    text: text.slice(0, from) + inserted + text.slice(to),
    startLine: lineNumber(text, from),
    endLine: lineNumber(text, to - terminator.length),
  };
}

import { truncateHead } from "@earendil-works/pi-coding-agent";
import { type BoundaryError, lineNumber } from "./replace-range.js";

// Reserve room for operation summaries and notices within 200 lines / 8 KiB.
const previewLimits = { maxLines: 190, maxBytes: 6 * 1024 };

/** Clip by UTF-8 bytes without splitting a code point. */
function clip(text: string, maxBytes: number) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    bytes += Buffer.byteLength(char, "utf8");
    if (bytes > maxBytes - 16) break;
    end += char.length;
  }
  return `${text.slice(0, end)}[…truncated]`;
}

/** Keep both ends even when the entire selection is a single oversized line. */
function clipLine(text: string, maxBytes: number) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const budget = Math.floor(maxBytes / 2);
  let suffix = "";
  let bytes = 0;
  // Only a bounded suffix is materialized, regardless of the source line size.
  const ending = text.slice(-budget);
  for (const char of [...ending].reverse()) {
    bytes += Buffer.byteLength(char, "utf8");
    if (bytes > budget) break;
    suffix = char + suffix;
  }
  return clip(text, budget) + suffix;
}

export function displayPath(path: string) {
  // Quote unusual paths so embedded newlines cannot obscure the operation header.
  return clip(JSON.stringify(path), 512);
}

export function boundedOutput(text: string) {
  let clipped = false;
  const lines = text.split("\n").map((line) => {
    const next = clip(line, 2048);
    clipped ||= next !== line;
    return next;
  });
  const output = truncateHead(lines.join("\n"), previewLimits);
  const truncated = clipped || output.truncated;
  return {
    text: output.content + (truncated ? "\n[Output truncated; use read to inspect the file.]" : ""),
    truncated,
  };
}

function physicalLines(text: string) {
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

/** A small selection is complete; a large one retains both ends under one budget. */
export function selectionPreview(text: string, startLine: number) {
  const lines = physicalLines(text);
  const row = (index: number) => `${startLine + index} | ${lines[index]?.replace(/\r$/, "") ?? ""}`;
  if (lines.length <= previewLimits.maxLines) {
    const full = lines.map((_, index) => row(index)).join("\n");
    if (Buffer.byteLength(full, "utf8") <= previewLimits.maxBytes) {
      return { text: full, truncated: false };
    }
  }

  const head: string[] = [];
  const tail: string[] = [];
  let bytes = 0;
  // Alternate ends, leaving room for omission/truncation notices. Long lines get
  // excerpts, but cannot prevent either boundary from appearing in the preview.
  while (head.length + tail.length < Math.min(lines.length, previewLimits.maxLines - 3)) {
    const takeHead = head.length <= tail.length;
    const index = takeHead ? head.length : lines.length - tail.length - 1;
    const next = clipLine(row(index), 1000);
    if (bytes + Buffer.byteLength(next, "utf8") + 1 > previewLimits.maxBytes - 256) break;
    bytes += Buffer.byteLength(next, "utf8") + 1;
    if (takeHead) head.push(next);
    else tail.unshift(next);
  }
  const omitted = lines.length - head.length - tail.length;
  return {
    text: [
      ...head,
      ...(omitted ? [`[${omitted} lines omitted]`] : []),
      ...tail,
      "[Preview truncated; use read to inspect the full selection.]",
    ].join("\n"),
    truncated: true,
  };
}

function location(text: string, at: number) {
  const from = at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
  return {
    line: lineNumber(text, at),
    column: [...text.slice(from, at)].length + 1,
    offset: at - from,
  };
}

const rejectionText = {
  "before-start": "before the resolved starting line; not eligible",
  "incomplete-line":
    "ends mid-line or splits CRLF; include content through a complete line boundary or EOF",
  "excludes-start": "does not enclose the full start anchor; choose a later end",
};

export function boundaryDiagnostic(text: string, error: BoundaryError) {
  const label = error.selector === "start" ? "Start" : "End";
  const lines = [`${label} selector ${clip(JSON.stringify(error.anchor), 512)}: ${error.kind}.`];
  if (error.startAt !== undefined) {
    const start = location(text, error.startAt);
    lines.push(`Resolved start: line ${start.line}, column ${start.column}.`);
  }
  if (error.kind === "empty") {
    lines.push(
      "Supply nonempty literal content for this selector; reread the relevant file content.",
    );
  } else if (error.kind === "ambiguous") {
    lines.push(
      `${error.countExact ? "" : "At least "}${error.matchCount} ${error.selector === "end" ? "eligible " : ""}matches (${error.countExact ? "exact total" : "search stopped"}); showing ${error.candidates.length}.`,
      `Use a more distinctive ${error.selector} anchor, including adjacent literal content if needed.`,
    );
  } else {
    lines.push(
      "Matching is literal and case-sensitive, including whitespace and LF/CRLF. Reread the relevant content and copy the exact anchor.",
    );
    if (error.selector === "end") {
      lines.push(
        "End must begin on or after the resolved starting line, finish at a complete LF/CRLF boundary or EOF, and enclose the entire start anchor.",
      );
    }
    if (error.matchCount)
      lines.push(
        `${error.matchCount} literal matches (exact total), none eligible; showing ${error.candidates.length} examples.`,
      );
  }

  // Merge overlapping three-line windows, including the finishing line of a
  // multiline match. Center long source lines near their candidate, not column 1.
  const windows = new Set<number>();
  const focuses = new Map<number, number>();
  const fileLines = physicalLines(text);
  const addContext = (offset: number) => {
    const at = location(text, offset);
    if (!focuses.has(at.line)) focuses.set(at.line, at.offset);
    for (
      let line = Math.max(1, at.line - 1);
      line <= Math.min(fileLines.length, at.line + 1);
      line++
    )
      windows.add(line);
    return at;
  };
  for (const candidate of error.candidates) {
    const at = addContext(candidate.at);
    const finish = addContext(candidate.at + error.anchor.length - 1);
    lines.push(
      `Candidate line ${at.line}, column ${at.column}${finish.line !== at.line ? `, through line ${finish.line}` : ""}${candidate.reason ? `: ${rejectionText[candidate.reason]}` : ""}.`,
    );
  }
  // Even a missing end can provide useful context at the successfully resolved start.
  if (error.startAt !== undefined) addContext(error.startAt);
  let previous = 0;
  for (const line of [...windows].sort((a, b) => a - b)) {
    if (previous && line > previous + 1) lines.push("[context omitted]");
    const source = fileLines[line - 1]?.replace(/\r$/, "") ?? "";
    let from = Math.max(0, (focuses.get(line) ?? 0) - 24);
    // Do not cut into a surrogate pair when centering the excerpt.
    if (from && /[\uDC00-\uDFFF]/.test(source[from] ?? "")) from++;
    lines.push(clip(`${line} | ${from ? "[…] " : ""}${source.slice(from)}`, 256));
    previous = line;
  }
  return boundedOutput(lines.join("\n")).text;
}

export function operationError(
  operation: string,
  path: string,
  error: unknown,
  writeStarted: boolean,
) {
  const message = error instanceof Error ? error.message : String(error);
  const reason = boundedOutput(message).text;
  // Preserve host error codes for programmatic callers without echoing unbounded
  // paths into the model-facing message. Never promise rollback after write begins.
  return Object.assign(
    new Error(
      `${operation} failed for ${displayPath(path)}.\n${writeStarted ? "Writing began; the file may be partially modified. Reread it before retrying." : "No changes were made by this operation."}\n${reason}`,
      { cause: error },
    ),
    error instanceof Error && "code" in error ? { code: error.code } : {},
  );
}

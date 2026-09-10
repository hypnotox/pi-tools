import { truncateHead } from "@earendil-works/pi-coding-agent";
import { type BoundaryError, blockStats, location, type resolveRanges } from "./replace-range.js";

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

/** Content is literal, including CRLF. Only omission markers are synthetic. */
export function rangePreview(text: string, maxLines: number | "all" = 40, maxBytes = 6144) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const budget = maxLines === "all" ? lines.length : maxLines;
  if (lines.length <= budget && Buffer.byteLength(text) <= maxBytes) {
    return { text, truncated: false };
  }
  const head: string[] = [];
  const tail: string[] = [];
  let bytes = 0;
  while (head.length + tail.length < Math.min(lines.length, budget)) {
    const takeHead = head.length <= tail.length;
    const index = takeHead ? head.length : lines.length - tail.length - 1;
    const source = lines[index] ?? "";
    // Share the remaining byte budget between both ends. A huge line must
    // not consume the entire preview or hide the last selected content.
    const allowance = Math.min(2048, Math.floor((maxBytes - 128 - bytes) / 2));
    if (allowance < 64) break;
    const next = clipLine(source, allowance);
    bytes += Buffer.byteLength(next);
    if (takeHead) head.push(next);
    else tail.unshift(next);
  }
  const omitted = lines.length - head.length - tail.length;
  return {
    text: head.join("") + (omitted ? `\n[${omitted} content lines omitted]\n` : "") + tail.join(""),
    truncated: true,
  };
}

export function span(range: {
  start: { line: number; column: number };
  end: { line: number; column: number };
}) {
  return `[${range.start.line}:${range.start.column}, ${range.end.line}:${range.end.column})`;
}

function readSection(
  text: string,
  result: ReturnType<typeof resolveRanges>[number],
  index: number,
  maxLines: number | "all" | undefined,
  maxBytes: number,
) {
  if (result.error) {
    const diagnostic = boundaryDiagnostic(text, result.error);
    const message = clip(diagnostic, Math.min(maxBytes - 64, 2048));
    return {
      text: `\nRange ${index + 1} | ERROR\n${message}\n`,
      details: { index, truncated: message !== diagnostic, error: result.error.kind },
    };
  }
  const range = result.range;
  const selectedText = text.slice(range.from, range.to);
  const selected = blockStats(selectedText);
  const header = `\nRange ${index + 1} | ${span(range)} | ${selected.lines} lines, ${selected.bytes} bytes`;
  const preview = rangePreview(
    selectedText,
    maxLines,
    maxBytes - Buffer.byteLength(`${header} | complete\n\n`),
  );
  return {
    text: `${header} | ${preview.truncated ? "truncated" : "complete"}\n${preview.text}\n`,
    details: { index, span: span(range), selected, truncated: preview.truncated },
  };
}

/** Bound the entire multi-range response, including headers and diagnostics. */
export function readFeedback(
  path: string,
  text: string,
  results: ReturnType<typeof resolveRanges>,
  maxLines?: number | "all",
) {
  const ceiling = 8192;
  const failedCount = results.filter((result) => result.error).length;
  let output = `${displayPath(path)} | ${results.length} ranges | read-only${failedCount ? ` | ${failedCount} invalid ranges` : ""}\n`;
  const sections = results.map((result, index) =>
    readSection(text, result, index, maxLines, ceiling),
  );
  // Do not impose a per-range byte limit when all requested output fits.
  const fits =
    Buffer.byteLength(output) +
      sections.reduce((bytes, section) => bytes + Buffer.byteLength(section.text), 0) <=
    ceiling;
  const ranges: ReturnType<typeof readSection>["details"][] = [];
  for (const [index, section] of sections.entries()) {
    const remaining = ceiling - Buffer.byteLength(output) - (fits ? 0 : 128);
    if (!fits && remaining < 512) {
      output += `\n[Output ceiling reached; ranges ${index + 1}–${results.length} omitted. Request fewer ranges.]`;
      break;
    }
    // Share constrained output so a large first range does not hide later
    // results/diagnostics. Unused space remains available to subsequent ranges.
    const allowance = fits
      ? remaining
      : Math.max(512, Math.floor(remaining / (results.length - index)));
    const result = results[index];
    if (!result) throw new Error("Missing range result");
    const shown =
      Buffer.byteLength(section.text) <= allowance
        ? section
        : readSection(text, result, index, maxLines, allowance);
    output += shown.text;
    ranges.push(shown.details);
  }
  return {
    text: output,
    ranges,
    truncated: ranges.length < results.length || ranges.some((range) => range.truncated),
    failed: failedCount > 0,
  };
}

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
      `${error.countExact ? "" : "At least "}${error.matchCount} matches (${error.countExact ? "exact total" : "search stopped"}); showing ${error.candidates.length}.`,
      `Use a more distinctive ${error.selector} anchor, including adjacent literal content if needed.`,
    );
  } else if (error.kind === "invalid UTF-8") {
    lines.push(
      "Use complete Unicode characters in anchors, not unpaired surrogates; reread and copy the exact content.",
    );
  } else if (error.kind === "reversed") {
    lines.push(
      "End position is before start. Choose a later end or correct the before/after sides; positions do not snap to lines.",
    );
  } else {
    lines.push(
      "Matching is literal and case-sensitive, including whitespace and LF/CRLF. Reread the relevant content and copy the exact anchor.",
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
      `Candidate line ${at.line}, column ${at.column}${finish.line !== at.line ? `, through line ${finish.line}` : ""}.`,
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

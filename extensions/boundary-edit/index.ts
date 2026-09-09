import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  type EditToolDetails,
  type ExtensionAPI,
  generateDiffString,
  generateUnifiedPatch,
  renderDiff,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import {
  boundaryDiagnostic,
  boundedOutput,
  displayPath,
  operationError,
  selectionPreview,
} from "./feedback.js";
import { BoundaryError, blockStats, replaceRange, resolveRange } from "./replace-range.js";

const selectors = {
  path: Type.String({
    minLength: 1,
    description: "Existing UTF-8 file, relative to cwd or absolute; supports ~/ and a leading @.",
  }),
  start: Type.String({
    minLength: 1,
    description: "Literal, globally unique start content. The containing whole line is selected.",
  }),
  end: Type.String({
    minLength: 1,
    description:
      "Literal end content: exactly one eligible match from the starting line onward, ending at a complete LF/CRLF boundary or EOF and enclosing the full start.",
  }),
};
const selectionParameters = Type.Object(selectors, { additionalProperties: false });
const editParameters = Type.Object(
  {
    ...selectors,
    replacement: Type.String({
      description:
        "Multiline replacement for the inclusive whole-line range. Empty deletes it. Include any selected content to retain.",
    }),
  },
  { additionalProperties: false },
);

export type BoundarySelectInput = Static<typeof selectionParameters>;
export type BoundaryEditInput = Static<typeof editParameters>;

interface BoundarySelectDetails {
  path: string;
  startLine: number;
  endLine: number;
  selected: ReturnType<typeof blockStats>;
  truncated: boolean;
}

interface BoundaryEditDetails extends BoundarySelectDetails, EditToolDetails {
  changed: boolean;
  outcome: "replaced" | "deleted" | "unchanged";
  replacement: ReturnType<typeof blockStats>;
  summary: string;
}

function resolvePath(path: string, cwd: string) {
  const local = path.startsWith("@") ? path.slice(1) : path;
  if (!local) throw new Error("Path must be nonempty after removing the leading @.");
  return resolve(
    cwd,
    local === "~" ? homedir() : local.startsWith("~/") ? resolve(homedir(), local.slice(2)) : local,
  );
}

async function readCurrentFile(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const bytes = await fs.readFile(path);
  signal?.throwIfAborted();
  // Fatal decoding prevents a whole-file write from corrupting unsupported bytes.
  const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const bom = decoded.startsWith("\uFEFF") ? "\uFEFF" : "";
  return { bytes, bom, text: decoded.slice(bom.length) };
}

function diagnosticError(text: string, error: unknown) {
  return error instanceof BoundaryError
    ? new Error(boundaryDiagnostic(text, error), { cause: error })
    : error;
}

const matchingDescription =
  "Start must be globally unique; end must be uniquely eligible from the starting line onward and finish at a complete line boundary or EOF, enclosing the full start. Both anchor lines are included. Matching and line endings are literal.";
const selectionGuidance =
  "For early validation, call boundary_select and wait for its result before generating replacement text. Selection is optional and stateless: boundary_edit re-resolves anchors against the current file, with no reservation or snapshot-conflict detection.";

export default function boundaryEdit(pi: ExtensionAPI): void {
  pi.registerTool<typeof editParameters, BoundaryEditDetails>({
    name: "boundary_edit",
    label: "Boundary edit",
    description: `Replace one inclusive whole-line range in an existing UTF-8 file using exact start/end content. ${matchingDescription} Empty replacement deletes the range. If nonempty replacement lacks a final LF/CRLF, retain the selected final line's terminator. Direct editing needs no boundary_select call. No snapshot-conflict detection: changed interior is overwritten. Feedback and each diff preview are limited to 200 lines or 8 KiB.`,
    promptSnippet: "Replace a whole-line block identified by exact, unique boundary content",
    promptGuidelines: [
      "Use boundary_edit for whole-block replacement when unique start/end content is simpler than copying the full old region; prefer edit for small substitutions or ambiguous boundaries.",
      "For boundary_edit, include both selected anchor lines in replacement if they should survive. Supply replacement as one multiline string, or an empty string for deletion.",
      selectionGuidance,
    ],
    parameters: editParameters,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("boundary_edit"))} ${theme.fg("accent", args.path ?? "...")}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const text = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const body = context.isError
        ? theme.fg("error", text)
        : result.details?.diff
          ? `${theme.fg("toolOutput", result.details.summary ?? text)}\n\n${renderDiff(result.details.diff.replace(/\r/g, ""), { filePath: context.args.path })}`
          : theme.fg("toolOutput", text);
      return new Text(body ? `\n${body}` : "", 0, 0);
    },
    async execute(_id, params, signal, _update, ctx) {
      let writeStarted = false;
      let text = "";
      try {
        signal?.throwIfAborted();
        const absolutePath = resolvePath(params.path, ctx.cwd);
        return await withFileMutationQueue(absolutePath, async () => {
          const current = await readCurrentFile(absolutePath, signal);
          text = current.text;
          if (Buffer.from(params.replacement, "utf8").toString("utf8") !== params.replacement) {
            throw new Error(
              "Replacement must be losslessly representable as UTF-8 (no unpaired surrogates).",
            );
          }
          const result = replaceRange(text, params);
          const next = Buffer.from(current.bom + result.text, "utf8");
          const changed = !current.bytes.equals(next);
          const outcome: BoundaryEditDetails["outcome"] = !changed
            ? "unchanged"
            : params.replacement === ""
              ? "deleted"
              : "replaced";
          const diffResult = generateDiffString(text, result.text);
          const diff = boundedOutput(diffResult.diff);
          const patch = boundedOutput(
            changed ? generateUnifiedPatch(params.path, text, result.text) : "",
          );
          const summary =
            `${displayPath(params.path)} | ${outcome} | original lines ${result.startLine}–${result.endLine}\n` +
            `${result.selected.lines} lines, ${result.selected.bytes} bytes → ${result.replacement.lines} lines, ${result.replacement.bytes} bytes` +
            (diff.truncated || patch.truncated
              ? "\n[Diff preview truncated; use read to inspect the resulting file.]"
              : "");
          const feedback = {
            content: [
              { type: "text" as const, text: summary + (diff.text ? `\n\n${diff.text}` : "") },
            ],
            details: {
              path: absolutePath,
              summary,
              diff: diff.text,
              patch: patch.text,
              ...(diffResult.firstChangedLine === undefined
                ? {}
                : { firstChangedLine: diffResult.firstChangedLine }),
              changed,
              outcome,
              startLine: result.startLine,
              endLine: result.endLine,
              selected: result.selected,
              replacement: result.replacement,
              truncated: diff.truncated || patch.truncated,
            },
          };
          signal?.throwIfAborted();
          // Keep the queue until I/O settles. Cancellation or I/O failure during a
          // write does not guarantee unchanged bytes; do not race it against abort.
          if (changed) {
            writeStarted = true;
            await fs.writeFile(absolutePath, next);
          }
          return feedback;
        });
      } catch (error) {
        throw operationError(
          "boundary_edit",
          params.path,
          diagnosticError(text, error),
          writeStarted,
        );
      }
    },
  });

  pi.registerTool<typeof selectionParameters, BoundarySelectDetails>({
    name: "boundary_select",
    label: "Boundary select",
    description: `Inspect one inclusive whole-line range in an existing UTF-8 file without modifying it. ${matchingDescription} Returns the inclusive line range, line/UTF-8 byte counts, and a bounded numbered preview with beginning/end excerpts when large. Optional and stateless: no selection IDs, stored snapshots, or reservations. Wait for this result before generating replacement text for boundary_edit. Feedback is limited to 200 lines or 8 KiB.`,
    promptSnippet: "Validate and preview exact whole-line boundaries without modifying a file",
    promptGuidelines: [selectionGuidance],
    parameters: selectionParameters,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("boundary_select"))} ${theme.fg("accent", args.path ?? "...")}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const text = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      return new Text(`\n${theme.fg(context.isError ? "error" : "toolOutput", text)}`, 0, 0);
    },
    async execute(_id, params, signal, _update, ctx) {
      let text = "";
      try {
        signal?.throwIfAborted();
        const absolutePath = resolvePath(params.path, ctx.cwd);
        // A queued read avoids observing an in-progress participating mutation.
        // The queue ends with this call; nothing is reserved for a later edit.
        return await withFileMutationQueue(absolutePath, async () => {
          text = (await readCurrentFile(absolutePath, signal)).text;
          const range = resolveRange(text, params);
          const selectedText = text.slice(range.from, range.to);
          const selected = blockStats(selectedText);
          const preview = selectionPreview(selectedText, range.startLine);
          signal?.throwIfAborted();
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `${displayPath(params.path)} | selected | lines ${range.startLine}–${range.endLine}\n` +
                  `${selected.lines} lines, ${selected.bytes} bytes | read-only\n\n${preview.text}`,
              },
            ],
            details: {
              path: absolutePath,
              startLine: range.startLine,
              endLine: range.endLine,
              selected,
              truncated: preview.truncated,
            },
          };
        });
      } catch (error) {
        throw operationError("boundary_select", params.path, diagnosticError(text, error), false);
      }
    },
  });
}

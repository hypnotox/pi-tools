import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
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
  readFeedback,
  span,
} from "./feedback.js";
import { BoundaryError, replaceRanges, resolveRanges } from "./replace-range.js";

const pathParameter = Type.String({
  minLength: 1,
  description: "Existing UTF-8 file, relative to cwd or absolute; supports ~/ and a leading @.",
});
const endpoint = Type.Object(
  {
    text: Type.String({
      minLength: 1,
      description:
        "Globally unique literal content, inline or multiline, including exact whitespace and line endings.",
    }),
    side: StringEnum(["before", "after"] as const, {
      description:
        "Position immediately before or after the entire matched text; no line snapping.",
    }),
  },
  { additionalProperties: false },
);
const selectors = { start: endpoint, end: endpoint };
const readParameters = Type.Object(
  {
    path: pathParameter,
    ranges: Type.Array(Type.Object(selectors, { additionalProperties: false }), { minItems: 1 }),
    maxLines: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1 }), StringEnum(["all"] as const)], {
        description:
          "Output only: total content-line budget per range (default 40), or all selected content; always subject to the overall 8 KiB ceiling.",
      }),
    ),
  },
  { additionalProperties: false },
);
const editParameters = Type.Object(
  {
    path: pathParameter,
    edits: Type.Array(
      Type.Object(
        {
          ...selectors,
          replacement: Type.String({
            description:
              "Exact replacement; empty deletes. No spaces or line terminators are inferred or preserved inside the selected span.",
          }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);

export type BoundaryReadInput = Static<typeof readParameters>;
export type BoundaryEditInput = Static<typeof editParameters>;

interface BoundaryEditDetails extends EditToolDetails {
  path: string;
  changed: boolean;
  entries: NonNullable<ReturnType<typeof replaceRanges>["entries"]>;
  truncated: boolean;
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
  "Both endpoints use globally unique literal text and a before/after side. Positions are exact, without line snapping; the selected span is half-open. Matching is case-sensitive, including whitespace and line endings.";
const readGuidance =
  "Use boundary_read when known start/end content identifies the region you want to inspect. It can also validate uncertain boundaries before generating a substantial replacement for boundary_edit; reading first is optional.";

export default function boundaryEdit(pi: ExtensionAPI): void {
  pi.registerTool<typeof editParameters, BoundaryEditDetails>({
    name: "boundary_edit",
    label: "Boundary edit",
    description: `Replace or delete multiple exact content-anchored regions in one existing UTF-8 file. ${matchingDescription} Resolve all edits against the same original content and validate the whole batch before writing. Overlapping regions and duplicate insertion points are rejected; shared context anchors are allowed. Replacement is literal: no inferred whitespace or retained terminators. No preflight or snapshot protection; current interior is overwritten. Validation failures leave the file unchanged, not a rollback promise after I/O failure. Feedback and each diff preview are bounded to 200 lines / 8 KiB.`,
    promptSnippet: "Replace or delete multiple exact content-anchored regions in one file",
    promptGuidelines: [
      "Prefer boundary editing with boundary_edit for replacing or deleting substantial regions when expressing their boundaries is simpler than reproducing their old contents. Use ordinary editing for small, exact substitutions.",
      "For boundary_edit, use one edits array per file; all endpoints resolve against the original content. Supply exactly the replacement wanted, including any whitespace or terminators inside the selected span. Context anchors outside that span remain untouched.",
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
          const result = replaceRanges(text, params.edits);
          if (result.errors) {
            throw new Error(
              boundedOutput(
                result.errors
                  .map(
                    ({ index, error }) =>
                      `Edit ${index + 1}: ${String((diagnosticError(text, error) as Error).message)}`,
                  )
                  .join("\n\n"),
              ).text,
            );
          }
          const next = Buffer.from(current.bom + result.text, "utf8");
          const changed = !current.bytes.equals(next);
          const diffResult = generateDiffString(text, result.text);
          const diff = boundedOutput(diffResult.diff);
          const patch = boundedOutput(
            changed ? generateUnifiedPatch(params.path, text, result.text) : "",
          );
          const summaryResult = boundedOutput(
            `${displayPath(params.path)} | ${result.entries.length} edits | ${changed ? "changed" : "unchanged"}\n` +
              result.entries
                .map(
                  (entry) =>
                    `Edit ${entry.index + 1}: ${entry.outcome} | original ${span(entry)} | ${entry.selected.lines} lines, ${entry.selected.bytes} bytes → ${entry.replacement.lines} lines, ${entry.replacement.bytes} bytes`,
                )
                .join("\n") +
              (diff.truncated || patch.truncated
                ? "\n[Diff preview truncated; use read to inspect the resulting file.]"
                : ""),
          );
          const summary = summaryResult.text;
          const output = boundedOutput(summary + (diff.text ? `\n\n${diff.text}` : ""));
          const feedback = {
            content: [{ type: "text" as const, text: output.text }],
            details: {
              path: absolutePath,
              summary,
              diff: diff.text,
              patch: patch.text,
              ...(diffResult.firstChangedLine === undefined
                ? {}
                : { firstChangedLine: diffResult.firstChangedLine }),
              changed,
              entries: result.entries,
              truncated:
                summaryResult.truncated || diff.truncated || patch.truncated || output.truncated,
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

  pi.registerTool({
    name: "boundary_read",
    label: "Boundary read",
    description: `Read multiple content-anchored ranges in one existing UTF-8 file without modifying it. ${matchingDescription} Returns actual content, exact line:column spans and sizes per range. maxLines is output-only: default 40 content lines per range, a positive integer budget, or all. Larger ranges show beginning/end excerpts with omission markers; the entire response is capped at 8 KiB, including long lines and multiple ranges. Reports each range's success or diagnostic within that ceiling. Stateless: no snapshots, selection IDs or reservations; editing re-resolves current content.`,
    promptSnippet: "Read exact content-anchored ranges in one file",
    promptGuidelines: [readGuidance],
    parameters: readParameters,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("boundary_read"))} ${theme.fg("accent", args.path ?? "...")}`,
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
      let report: ReturnType<typeof readFeedback>;
      let absolutePath: string;
      try {
        signal?.throwIfAborted();
        absolutePath = resolvePath(params.path, ctx.cwd);
        // Queue only this read: no reservation persists for a later edit.
        report = await withFileMutationQueue(absolutePath, async () => {
          const { text } = await readCurrentFile(absolutePath, signal);
          const results = resolveRanges(text, params.ranges);
          const feedback = readFeedback(params.path, text, results, params.maxLines);
          signal?.throwIfAborted();
          return feedback;
        });
      } catch (error) {
        throw operationError("boundary_read", params.path, error, false);
      }
      // Pi requires throwing to set isError. Keep successful content alongside
      // all available diagnostics, without re-truncating complete read sections.
      if (report.failed) throw new Error(report.text);
      return {
        content: [{ type: "text" as const, text: report.text }],
        details: { path: absolutePath, ranges: report.ranges, truncated: report.truncated },
      };
    },
  });
}

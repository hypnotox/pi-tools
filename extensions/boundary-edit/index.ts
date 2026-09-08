import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  type EditToolDetails,
  type ExtensionAPI,
  generateDiffString,
  generateUnifiedPatch,
  renderDiff,
  truncateHead,
  truncateLine,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { replaceRange } from "./replace-range.js";

const parameters = Type.Object(
  {
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
    replacement: Type.String({
      description:
        "Multiline replacement for the inclusive whole-line range. Empty deletes it. Include any selected content to retain.",
    }),
  },
  { additionalProperties: false },
);

export type BoundaryEditInput = Static<typeof parameters>;

interface BoundaryEditDetails extends EditToolDetails {
  changed: boolean;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

// Leave room for the truncation notice within the advertised 200-line / 8-KiB cap.
const outputLimits = { maxLines: 198, maxBytes: 8 * 1024 - 128 };

function boundedOutput(text: string) {
  const output = truncateHead(text, outputLimits);
  return {
    text:
      output.content +
      (output.truncated ? "\n[Output truncated; use read to inspect the resulting file.]" : ""),
    truncated: output.truncated,
  };
}

export default function boundaryEdit(pi: ExtensionAPI): void {
  pi.registerTool<typeof parameters, BoundaryEditDetails>({
    name: "boundary_edit",
    label: "Boundary edit",
    description:
      "Replace one inclusive whole-line range in an existing UTF-8 file using exact start/end content. Start must be globally unique; end must be uniquely eligible from the starting line onward and finish at a complete line boundary or EOF. Both anchor lines are replaced. Empty replacement deletes them. Matching and supplied line endings are literal. If nonempty replacement lacks a final LF/CRLF, retain the selected final line's terminator. No snapshot-conflict detection: changed interior is overwritten. The confirmation and each diff preview are limited to 200 lines or 8 KiB.",
    promptSnippet: "Replace a whole-line block identified by exact, unique boundary content",
    promptGuidelines: [
      "Use boundary_edit for whole-block replacement when unique start/end content is simpler than copying the full old region; prefer edit for small substitutions or ambiguous boundaries.",
      "For boundary_edit, include both selected anchor lines in replacement if they should survive. Supply replacement as one multiline string, or an empty string for deletion.",
    ],
    parameters,
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
          ? renderDiff(result.details.diff.replace(/\r/g, ""), { filePath: context.args.path })
          : theme.fg("toolOutput", text);
      return new Text(body ? `\n${body}` : "", 0, 0);
    },
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const path = params.path.startsWith("@") ? params.path.slice(1) : params.path;
      if (!path) throw new Error("Path must be nonempty after removing the leading @.");
      const absolutePath = resolve(
        ctx.cwd,
        path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path,
      );

      return withFileMutationQueue(absolutePath, async () => {
        signal?.throwIfAborted();
        const bytes = await fs.readFile(absolutePath);
        signal?.throwIfAborted();
        // Fatal decoding prevents a whole-file write from corrupting unsupported bytes.
        const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        const bom = decoded.startsWith("\uFEFF") ? "\uFEFF" : "";
        const text = decoded.slice(bom.length);
        if (Buffer.from(params.replacement, "utf8").toString("utf8") !== params.replacement) {
          throw new Error(
            "Replacement must be losslessly representable as UTF-8 (no unpaired surrogates).",
          );
        }
        const result = replaceRange(text, params);
        const next = Buffer.from(bom + result.text, "utf8");
        const changed = !bytes.equals(next);
        const summary = boundedOutput(
          changed
            ? `Successfully replaced 1 block(s) in ${params.path}.`
            : `No change to ${JSON.stringify(params.path)}.`,
        );
        const diffResult = generateDiffString(text, result.text);
        // Match Pi edit's result shape, but bound persisted previews as well as text.
        const diff = boundedOutput(diffResult.diff);
        const patch = boundedOutput(
          changed ? generateUnifiedPatch(params.path, text, result.text) : "",
        );
        const feedback = {
          content: [
            {
              type: "text" as const,
              text:
                summary.text +
                (!summary.truncated && (diff.truncated || patch.truncated)
                  ? "\n[Diff preview truncated; use read to inspect the resulting file.]"
                  : ""),
            },
          ],
          details: {
            diff: diff.text,
            patch: patch.text,
            ...(diffResult.firstChangedLine === undefined
              ? {}
              : { firstChangedLine: diffResult.firstChangedLine }),
            changed,
            startLine: result.startLine,
            endLine: result.endLine,
            truncated: summary.truncated || diff.truncated || patch.truncated,
          },
        };
        signal?.throwIfAborted();
        // Keep the queue until I/O settles. Cancellation or I/O failure during a write
        // does not guarantee unchanged bytes; do not race the write against an abort.
        if (changed) await fs.writeFile(absolutePath, next);
        return feedback;
      }).catch((error: unknown) => {
        // Filesystem errors can echo arbitrarily long user paths. Keep failures
        // failures, preserving ordinary host errors unchanged when already bounded.
        const message = error instanceof Error ? error.message : String(error);
        const output = truncateHead(message, outputLimits);
        if (!output.truncated) throw error;
        // truncateHead drops an oversized first line entirely; retain its reason.
        const content = output.firstLineExceedsLimit
          ? truncateLine(message, 1000).text
          : output.content;
        throw new Error(`${content}\n[Error truncated.]`);
      });
    },
  });
}

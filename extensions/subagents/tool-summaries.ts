const MAX_VALUE = 256;

function isUnsafeCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = Array.from(value, (character) =>
    isUnsafeCodePoint(character.codePointAt(0) ?? 0) ? " " : character,
  )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return clean && clean.length <= MAX_VALUE ? clean : undefined;
}
function firstLogicalLine(value: string): string {
  const separators = ["\r", "\n", "\u0085", "\u2028", "\u2029"];
  const indexes = separators
    .map((separator) => value.indexOf(separator))
    .filter((index) => index >= 0);
  return indexes.length > 0 ? value.slice(0, Math.min(...indexes)) : value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function withValue(tool: string, value: unknown): string {
  return text(value) ? `${tool} ${text(value)}` : tool;
}

/** Safe, argument-only presentation for Pi's stable built-in tools. */
export function summarizeBuiltinTool(toolName: string, args: unknown): string | undefined {
  const values = record(args);
  if (!values) return undefined;
  const path = text(values.path);
  switch (toolName) {
    case "read": {
      if (!path) return toolName;
      const offset =
        Number.isInteger(values.offset) && (values.offset as number) >= 0
          ? ` offset=${values.offset}`
          : "";
      const limit =
        Number.isInteger(values.limit) && (values.limit as number) > 0
          ? ` limit=${values.limit}`
          : "";
      return `read ${path}${offset}${limit}`;
    }
    case "edit":
    case "write":
      return withValue(toolName, path);
    case "bash": {
      const firstLine =
        typeof values.command === "string" ? firstLogicalLine(values.command) : undefined;
      const command = text(firstLine);
      return command ? `bash ${command.split(/(?<!\\)[;&|]/)[0]?.trim() ?? ""}` : toolName;
    }
    case "grep": {
      const pattern = text(values.pattern);
      if (!pattern) return toolName;
      return `grep ${pattern}${path ? ` ${path}` : ""}${text(values.glob) ? ` ${text(values.glob)}` : ""}`;
    }
    case "find": {
      const pattern = text(values.pattern);
      return pattern ? `find ${pattern}${path ? ` ${path}` : ""}` : toolName;
    }
    case "ls":
      return path ? `ls ${path}` : "ls .";
    default:
      return undefined;
  }
}

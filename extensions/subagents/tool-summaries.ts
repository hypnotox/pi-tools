const MAX_VALUE = 256;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
      ? " "
      : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return clean && clean.length <= MAX_VALUE ? clean : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Returns a bounded argument summary without retaining raw child tool input. */
export function summarizeTool(toolName: string, args: unknown): string {
  const values = record(args);
  if (!values) return toolName;
  const path = text(values.path);
  switch (toolName) {
    case "read": {
      if (!path) return toolName;
      const offset = Number.isInteger(values.offset) ? ` offset=${values.offset}` : "";
      const limit = Number.isInteger(values.limit) ? ` limit=${values.limit}` : "";
      return `read ${path}${offset}${limit}`;
    }
    case "edit":
    case "write":
      return path ? `${toolName} ${path}` : toolName;
    case "bash":
      return toolName;
    case "grep": {
      const pattern = text(values.pattern);
      return pattern ? `grep ${pattern}${path ? ` ${path}` : ""}` : toolName;
    }
    case "find": {
      const pattern = text(values.pattern);
      return pattern ? `find ${pattern}${path ? ` ${path}` : ""}` : toolName;
    }
    case "ls":
      return path ? `ls ${path}` : "ls .";
    default:
      return toolName;
  }
}

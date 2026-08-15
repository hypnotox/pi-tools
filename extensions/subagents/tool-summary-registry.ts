import type {
  JsonValue,
  ToolSummaryRegistration,
  ToolSummaryRegistrationReceipt,
  ToolSummaryRegistrationResult,
  ToolSummaryResolver,
} from "./api.js";
import { SUBAGENT_TOOL_SUMMARY_PROTOCOL_VERSION } from "./api.js";

const BUILTIN_TOOL_NAMES = new Set(["read", "edit", "write", "bash", "grep", "find", "ls"]);
const MAX_SUMMARY_BYTES = 1024;

function frozenJson(value: unknown): JsonValue {
  try {
    const snapshot = JSON.parse(JSON.stringify(value)) as JsonValue;
    const freeze = (current: JsonValue): JsonValue => {
      if (!current || typeof current !== "object" || Object.isFrozen(current)) return current;
      for (const child of Object.values(current)) freeze(child as JsonValue);
      return Object.freeze(current) as JsonValue;
    };
    return freeze(snapshot);
  } catch {
    return Object.freeze({});
  }
}

function validSummary(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/[\0\r\n]/.test(value) &&
    Buffer.byteLength(value, "utf8") <= MAX_SUMMARY_BYTES
  );
}

/** Owns custom summary registrations until the session tool snapshot is final. */
export class ToolSummaryRegistry {
  #pending: Array<{ batch: ToolSummaryRegistration; receipt: ToolSummaryRegistrationReceipt }> = [];
  #receipts = new Map<string, ToolSummaryRegistrationReceipt>();
  #resolvers = new Map<string, ToolSummaryResolver>();
  #finalized = false;

  collect(batch: ToolSummaryRegistration): ToolSummaryRegistrationReceipt {
    if (batch && typeof batch === "object" && typeof batch.registrationId === "string") {
      const known = this.#receipts.get(batch.registrationId);
      if (known) return known;
    }
    if (this.#finalized)
      return { state: "late", reason: "Tool summary registration is closed for this session" };
    const receipt: ToolSummaryRegistrationReceipt = { state: "pending" };
    if (
      !batch ||
      typeof batch !== "object" ||
      !batch.registrationId?.trim() ||
      !Array.isArray(batch.resolvers) ||
      batch.resolvers.length === 0 ||
      batch.resolvers.some(
        (entry) => !entry?.toolName?.trim() || typeof entry.resolve !== "function",
      )
    ) {
      receipt.state = "rejected";
      receipt.reason = "A tool summary registration requires a registrationId and resolvers";
    } else {
      const names = new Set<string>();
      const duplicate = batch.resolvers.find(
        (entry) => names.has(entry.toolName) || !names.add(entry.toolName),
      );
      if (duplicate) {
        receipt.state = "rejected";
        receipt.reason = `Duplicate tool summary: ${duplicate.toolName}`;
      }
    }
    if (
      batch &&
      typeof batch === "object" &&
      typeof batch.registrationId === "string" &&
      batch.registrationId.trim()
    )
      this.#receipts.set(batch.registrationId, receipt);
    if (receipt.state === "pending")
      this.#pending.push({
        batch: Object.freeze({
          registrationId: batch.registrationId,
          resolvers: Object.freeze([...batch.resolvers]),
        }),
        receipt,
      });
    return receipt;
  }

  finalize(): ToolSummaryRegistrationResult[] {
    if (this.#finalized) return [];
    this.#finalized = true;
    const results: ToolSummaryRegistrationResult[] = [];
    for (const pending of this.#pending) {
      const collision = pending.batch.resolvers.find(
        (entry) => BUILTIN_TOOL_NAMES.has(entry.toolName) || this.#resolvers.has(entry.toolName),
      );
      if (collision) {
        pending.receipt.state = "rejected";
        pending.receipt.reason = BUILTIN_TOOL_NAMES.has(collision.toolName)
          ? `Reserved tool summary: ${collision.toolName}`
          : `Duplicate tool summary: ${collision.toolName}`;
      } else {
        pending.receipt.state = "registered";
        for (const entry of pending.batch.resolvers)
          this.#resolvers.set(entry.toolName, entry.resolve);
      }
      results.push({
        protocolVersion: SUBAGENT_TOOL_SUMMARY_PROTOCOL_VERSION,
        registrationId: pending.batch.registrationId,
        state: pending.receipt.state === "registered" ? "registered" : "rejected",
        ...(pending.receipt.reason === undefined ? {} : { reason: pending.receipt.reason }),
      });
    }
    return results;
  }

  resolve(toolName: string, args: unknown): string {
    const resolver = this.#resolvers.get(toolName);
    if (!resolver) return toolName;
    try {
      const summary = resolver(frozenJson(args));
      return validSummary(summary) ? summary : toolName;
    } catch {
      return toolName;
    }
  }
}

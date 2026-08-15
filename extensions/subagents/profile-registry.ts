import { IsSchema } from "typebox";
import type {
  ProfileDefinition,
  ProfileRegistration,
  ProfileRegistrationReceipt,
  ProfileRegistrationResult,
} from "./api.js";
import { SUBAGENT_PROFILE_PROTOCOL_VERSION } from "./api.js";

function isTypeBoxSchema(value: unknown): value is ProfileDefinition["parameters"] {
  return IsSchema(value) && typeof (value as Record<PropertyKey, unknown>)["~kind"] === "string";
}

function validateProfile(profile: ProfileDefinition): void {
  if (!profile || typeof profile !== "object") throw new Error("Profile definition is required");
  if (!profile.id.trim() || !profile.toolName.trim())
    throw new Error("Profile id and tool name are required");
  if (!profile.label.trim() || !profile.description.trim())
    throw new Error(`Profile ${profile.id} requires a label and description`);
  if (
    profile.promptSnippet !== undefined &&
    (typeof profile.promptSnippet !== "string" ||
      !profile.promptSnippet.trim() ||
      profile.promptSnippet.length > 4096 ||
      /[\r\n]/.test(profile.promptSnippet))
  )
    throw new Error(`Profile ${profile.id} promptSnippet must be a non-empty single line`);
  if (
    profile.promptGuidelines !== undefined &&
    (!Array.isArray(profile.promptGuidelines) ||
      profile.promptGuidelines.length > 64 ||
      profile.promptGuidelines.some(
        (guideline) =>
          typeof guideline !== "string" ||
          !guideline.trim() ||
          guideline.length > 4096 ||
          !guideline.includes(profile.toolName),
      ))
  )
    throw new Error(
      `Profile ${profile.id} promptGuidelines must be bounded non-empty strings naming ${profile.toolName}`,
    );
  if (!isTypeBoxSchema(profile.parameters))
    throw new Error(`Profile ${profile.id} requires a TypeBox parameter schema`);
  if (!isTypeBoxSchema(profile.profileDataSchema))
    throw new Error(`Profile ${profile.id} requires a TypeBox profile-data schema`);
  if (
    typeof profile.selectModel !== "function" ||
    typeof profile.prepare !== "function" ||
    (profile.selectThinkingLevel !== undefined &&
      typeof profile.selectThinkingLevel !== "function") ||
    (profile.beforeRun !== undefined && typeof profile.beforeRun !== "function") ||
    (profile.afterRun !== undefined && typeof profile.afterRun !== "function")
  )
    throw new Error(`Profile ${profile.id} has invalid callbacks`);
  if (
    profile.concurrency !== undefined &&
    (!Number.isInteger(profile.concurrency) || profile.concurrency < 1)
  )
    throw new Error(`Profile ${profile.id} concurrency must be a positive integer`);
}

function cloneFrozenValue<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const known = seen.get(value);
  if (known !== undefined) return known as T;
  const clone: object = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) descriptor.value = cloneFrozenValue(descriptor.value, seen);
    Object.defineProperty(clone, key, descriptor);
  }
  return Object.freeze(clone) as T;
}

function snapshotProfile(profile: ProfileDefinition): ProfileDefinition {
  return Object.freeze({
    ...profile,
    parameters: cloneFrozenValue(profile.parameters),
    profileDataSchema: cloneFrozenValue(profile.profileDataSchema),
    ...(profile.promptGuidelines === undefined
      ? {}
      : { promptGuidelines: cloneFrozenValue(profile.promptGuidelines) }),
  });
}

interface PendingBatch {
  batch: Readonly<
    Omit<ProfileRegistration, "profiles"> & { profiles: readonly ProfileDefinition[] }
  >;
  receipt: ProfileRegistrationReceipt;
}

/** Collects extension registrations until Pi has the complete session tool snapshot. */
export class ProfileRegistry {
  readonly #defaultProfile: ProfileDefinition;
  #batches: PendingBatch[] = [];
  #receipts = new Map<string, ProfileRegistrationReceipt>();
  #finalized = false;
  #active: ProfileDefinition[] | undefined;

  constructor(defaultProfile: ProfileDefinition) {
    validateProfile(defaultProfile);
    this.#defaultProfile = snapshotProfile(defaultProfile);
  }

  collect(batch: ProfileRegistration): ProfileRegistrationReceipt {
    if (
      batch &&
      typeof batch === "object" &&
      typeof batch.registrationId === "string" &&
      batch.registrationId.trim()
    ) {
      const known = this.#receipts.get(batch.registrationId);
      if (known) return known;
    }
    if (this.#finalized)
      return { state: "late", reason: "Profile registration is closed for this session" };
    const receipt: ProfileRegistrationReceipt = { state: "pending" };
    try {
      this.#validateBatch(batch);
    } catch (error) {
      receipt.state = "rejected";
      receipt.reason = error instanceof Error ? error.message : String(error);
      if (
        batch &&
        typeof batch === "object" &&
        typeof batch.registrationId === "string" &&
        batch.registrationId.trim()
      )
        this.#receipts.set(batch.registrationId, receipt);
      return receipt;
    }
    const snapshot = Object.freeze({
      registrationId: batch.registrationId,
      profiles: Object.freeze(batch.profiles.map(snapshotProfile)),
      ...(batch.suppressDefault === undefined ? {} : { suppressDefault: batch.suppressDefault }),
    });
    this.#batches.push({ batch: snapshot, receipt });
    this.#receipts.set(snapshot.registrationId, receipt);
    return receipt;
  }

  /** Compatibility seam for local composition; event-bus consumers use collect(). */
  register(batch: ProfileRegistration): void {
    const receipt = this.collect(batch);
    if (receipt.state === "rejected") throw new Error(receipt.reason);
  }

  finalize(existingTools: Iterable<string> = []): {
    profiles: ProfileDefinition[];
    transitions: ProfileRegistrationResult[];
  } {
    if (this.#finalized) return { profiles: this.profiles(), transitions: [] };
    const transitions: ProfileRegistrationResult[] = [];
    this.#finalized = true;
    const knownIds = new Set<string>();
    const knownTools = new Set(existingTools);
    const accepted: PendingBatch[] = [];

    for (const pending of this.#batches) {
      try {
        this.#validateBatch(pending.batch);
      } catch (error) {
        pending.receipt.state = "rejected";
        pending.receipt.reason = error instanceof Error ? error.message : String(error);
        transitions.push({
          protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION,
          registrationId: pending.batch.registrationId,
          state: "rejected",
          reason: pending.receipt.reason,
        });
        continue;
      }
      const ids = new Set<string>();
      const tools = new Set<string>();
      let collisionKind: "id" | "tool" | undefined;
      const collision = pending.batch.profiles.find((profile) => {
        if (
          ids.has(profile.id) ||
          knownIds.has(profile.id) ||
          (profile.id === this.#defaultProfile.id && !pending.batch.suppressDefault)
        ) {
          collisionKind = "id";
          return true;
        }
        ids.add(profile.id);
        if (
          tools.has(profile.toolName) ||
          knownTools.has(profile.toolName) ||
          (profile.toolName === this.#defaultProfile.toolName && !pending.batch.suppressDefault)
        ) {
          collisionKind = "tool";
          return true;
        }
        tools.add(profile.toolName);
        return false;
      });
      if (collision) {
        pending.receipt.state = "rejected";
        pending.receipt.reason =
          collisionKind === "id"
            ? `Duplicate profile id: ${collision.id}`
            : `Profile tool collision: ${collision.toolName}`;
        transitions.push({
          protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION,
          registrationId: pending.batch.registrationId,
          state: "rejected",
          reason: pending.receipt.reason,
        });
        continue;
      }
      pending.receipt.state = "registered";
      transitions.push({
        protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION,
        registrationId: pending.batch.registrationId,
        state: "registered",
      });
      accepted.push(pending);
      for (const profile of pending.batch.profiles) {
        knownIds.add(profile.id);
        knownTools.add(profile.toolName);
      }
    }

    const suppressDefault = accepted.some((entry) => entry.batch.suppressDefault === true);
    const defaultAvailable = !suppressDefault && !knownTools.has(this.#defaultProfile.toolName);
    this.#active = [
      ...(defaultAvailable ? [this.#defaultProfile] : []),
      ...accepted.flatMap((entry) => entry.batch.profiles),
    ];
    return { profiles: this.profiles(), transitions };
  }

  profiles(): ProfileDefinition[] {
    return this.#active ? [...this.#active] : [this.#defaultProfile];
  }

  profileTools(): Set<string> {
    return new Set([
      this.#defaultProfile.toolName,
      ...this.#batches.flatMap((entry) => entry.batch.profiles.map((profile) => profile.toolName)),
    ]);
  }

  find(toolName: string): ProfileDefinition | undefined {
    return this.profiles().find((profile) => profile.toolName === toolName);
  }

  #validateBatch(
    batch: Omit<ProfileRegistration, "profiles"> & { profiles: readonly ProfileDefinition[] },
  ): void {
    if (!batch || typeof batch !== "object")
      throw new Error("A profile registration batch is required");
    if (typeof batch.registrationId !== "string" || !batch.registrationId.trim())
      throw new Error("A profile registration batch requires a registrationId");
    if (!Array.isArray(batch.profiles) || batch.profiles.length === 0)
      throw new Error("A profile registration batch must contain profiles");
    if (batch.suppressDefault !== undefined && typeof batch.suppressDefault !== "boolean")
      throw new Error("suppressDefault must be boolean");
    const ids = new Set<string>();
    const tools = new Set<string>();
    for (const profile of batch.profiles) {
      validateProfile(profile);
      if (ids.has(profile.id)) throw new Error(`Duplicate profile id: ${profile.id}`);
      if (tools.has(profile.toolName))
        throw new Error(`Duplicate profile tool: ${profile.toolName}`);
      ids.add(profile.id);
      tools.add(profile.toolName);
    }
  }
}

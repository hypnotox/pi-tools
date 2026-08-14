import type { ProfileDefinition, ProfileRegistration, ProfileRegistrationReceipt } from "./api.js";

function validateProfile(profile: ProfileDefinition): void {
  if (!profile.id.trim() || !profile.toolName.trim())
    throw new Error("Profile id and tool name are required");
  if (!profile.label.trim() || !profile.description.trim())
    throw new Error(`Profile ${profile.id} requires a label and description`);
  if (!profile.parameters || typeof profile.parameters !== "object")
    throw new Error(`Profile ${profile.id} requires a TypeBox parameter schema`);
  if (!profile.profileDataSchema || typeof profile.profileDataSchema !== "object")
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

interface PendingBatch {
  batch: ProfileRegistration;
  receipt: ProfileRegistrationReceipt;
}

/** Collects extension registrations until Pi has the complete session tool snapshot. */
export class ProfileRegistry {
  readonly #defaultProfile: ProfileDefinition;
  #batches: PendingBatch[] = [];
  #finalized = false;
  #active: ProfileDefinition[] | undefined;

  constructor(defaultProfile: ProfileDefinition) {
    validateProfile(defaultProfile);
    this.#defaultProfile = defaultProfile;
  }

  collect(batch: ProfileRegistration): ProfileRegistrationReceipt {
    if (this.#finalized)
      return { state: "late", reason: "Profile registration is closed for this session" };
    const receipt: ProfileRegistrationReceipt = { state: "pending" };
    try {
      this.#validateBatch(batch);
    } catch (error) {
      receipt.state = "rejected";
      receipt.reason = error instanceof Error ? error.message : String(error);
      return receipt;
    }
    this.#batches.push({
      batch: {
        profiles: [...batch.profiles],
        ...(batch.suppressDefault === undefined ? {} : { suppressDefault: batch.suppressDefault }),
      },
      receipt,
    });
    return receipt;
  }

  /** Compatibility seam for local composition; event-bus consumers use collect(). */
  register(batch: ProfileRegistration): void {
    const receipt = this.collect(batch);
    if (receipt.state === "rejected") throw new Error(receipt.reason);
  }

  finalize(existingTools: Iterable<string> = []): ProfileDefinition[] {
    if (this.#finalized) return this.profiles();
    this.#finalized = true;
    const knownIds = new Set<string>();
    const knownTools = new Set(existingTools);
    const accepted: ProfileDefinition[] = [];
    let suppressDefault = false;
    for (const pending of this.#batches) {
      const candidate = pending.batch.profiles;
      const ids = new Set<string>();
      const tools = new Set<string>();
      const collision = candidate.find((profile) => {
        if (ids.has(profile.id) || knownIds.has(profile.id)) return true;
        ids.add(profile.id);
        if (tools.has(profile.toolName) || knownTools.has(profile.toolName)) return true;
        tools.add(profile.toolName);
        return false;
      });
      if (collision) {
        pending.receipt.state = "rejected";
        pending.receipt.reason = `Profile tool collision: ${collision.toolName}`;
        continue;
      }
      pending.receipt.state = "registered";
      accepted.push(...candidate);
      candidate.forEach((profile) => {
        knownIds.add(profile.id);
        knownTools.add(profile.toolName);
      });
      suppressDefault ||= pending.batch.suppressDefault === true;
    }
    // A successful suppressing batch may replace the default's tool name, so default is checked only now.
    if (!suppressDefault && knownTools.has(this.#defaultProfile.toolName)) {
      for (const pending of this.#batches) {
        if (
          pending.receipt.state === "registered" &&
          pending.batch.profiles.some((p) => p.toolName === this.#defaultProfile.toolName)
        ) {
          pending.receipt.state = "rejected";
          pending.receipt.reason = `Profile tool collision: ${this.#defaultProfile.toolName}`;
        }
      }
    }
    const registered = this.#batches
      .filter((entry) => entry.receipt.state === "registered")
      .flatMap((entry) => entry.batch.profiles);
    this.#active = [
      ...(this.#batches.some(
        (entry) => entry.receipt.state === "registered" && entry.batch.suppressDefault,
      )
        ? []
        : [this.#defaultProfile]),
      ...registered,
    ];
    return this.profiles();
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

  #validateBatch(batch: ProfileRegistration): void {
    if (!batch || !Array.isArray(batch.profiles) || batch.profiles.length === 0)
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

import type { ProfileDefinition, ProfileRegistration } from "./api.js";

export class ProfileRegistry {
  readonly #defaultProfile: ProfileDefinition;
  #registrations: ProfileRegistration[] = [];

  constructor(defaultProfile: ProfileDefinition) {
    this.#defaultProfile = defaultProfile;
  }

  register(batch: ProfileRegistration): void {
    const proposed = [...this.#registrations.flatMap((entry) => entry.profiles), ...batch.profiles];
    const ids = new Set<string>();
    const tools = new Set<string>();
    for (const profile of proposed) {
      if (!profile.id || !profile.toolName)
        throw new Error("Profile id and tool name are required");
      if (ids.has(profile.id)) throw new Error(`Duplicate profile id: ${profile.id}`);
      if (tools.has(profile.toolName))
        throw new Error(`Duplicate profile tool: ${profile.toolName}`);
      ids.add(profile.id);
      tools.add(profile.toolName);
    }
    // Validation completes before this mutation, making registration atomic.
    this.#registrations.push({
      profiles: [...batch.profiles],
      ...(batch.suppressDefault === undefined ? {} : { suppressDefault: batch.suppressDefault }),
    });
  }

  profiles(): ProfileDefinition[] {
    const suppressDefault = this.#registrations.some((batch) => batch.suppressDefault);
    return [
      ...(suppressDefault ? [] : [this.#defaultProfile]),
      ...this.#registrations.flatMap((batch) => batch.profiles),
    ];
  }

  profileTools(): Set<string> {
    return new Set(this.profiles().map((profile) => profile.toolName));
  }

  find(toolName: string): ProfileDefinition | undefined {
    return this.profiles().find((profile) => profile.toolName === toolName);
  }
}

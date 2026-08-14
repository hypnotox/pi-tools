export class ProfileScheduler {
  #queues = new Map<string, Array<() => void>>();
  #running = new Map<string, number>();
  #disposed = false;

  async run<T>(
    profileId: string,
    concurrency: number,
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    if (this.#disposed) throw new Error("Subagent scheduler is shut down");
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    await new Promise<void>((resolve, reject) => {
      const start = (): void => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = (): void => {
        const queue = this.#queues.get(profileId);
        if (queue)
          this.#queues.set(
            profileId,
            queue.filter((entry) => entry !== start),
          );
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      if ((this.#running.get(profileId) ?? 0) < concurrency) {
        this.#running.set(profileId, (this.#running.get(profileId) ?? 0) + 1);
        start();
      } else {
        const queue = this.#queues.get(profileId) ?? [];
        queue.push(start);
        this.#queues.set(profileId, queue);
        signal?.addEventListener("abort", abort, { once: true });
      }
    });
    try {
      return await task();
    } finally {
      const next = this.#queues.get(profileId)?.shift();
      if (next) next();
      else this.#running.set(profileId, Math.max(0, (this.#running.get(profileId) ?? 1) - 1));
    }
  }

  validateExclusiveSiblingBatch(
    toolNames: readonly string[],
    exclusiveTools: ReadonlySet<string>,
  ): void {
    if (toolNames.some((tool) => exclusiveTools.has(tool)) && toolNames.length > 1) {
      throw new Error("An exclusive subagent tool cannot run beside sibling tools");
    }
  }

  shutdown(): void {
    this.#disposed = true;
    this.#queues.clear();
    this.#running.clear();
  }
}

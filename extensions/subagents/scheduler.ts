interface QueueEntry {
  start(): void;
  reject(error: unknown): void;
  removeAbort(): void;
}

export class ProfileScheduler {
  #queues = new Map<string, QueueEntry[]>();
  #running = new Map<string, number>();
  #disposed = false;

  async run<T>(
    profileId: string,
    concurrency: number,
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
    onQueued?: (position: number) => void,
  ): Promise<T> {
    if (this.#disposed) throw new Error("Subagent scheduler is shut down");
    if (!Number.isInteger(concurrency) || concurrency < 1)
      throw new Error("Profile concurrency must be a positive integer");
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

    await new Promise<void>((resolve, reject) => {
      if ((this.#running.get(profileId) ?? 0) < concurrency) {
        this.#running.set(profileId, (this.#running.get(profileId) ?? 0) + 1);
        resolve();
        return;
      }

      const abort = (): void => {
        const queue = this.#queues.get(profileId);
        if (queue)
          this.#queues.set(
            profileId,
            queue.filter((candidate) => candidate !== entry),
          );
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const entry: QueueEntry = {
        start: () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        },
        reject,
        removeAbort: () => signal?.removeEventListener("abort", abort),
      };
      const queue = this.#queues.get(profileId) ?? [];
      queue.push(entry);
      this.#queues.set(profileId, queue);
      signal?.addEventListener("abort", abort, { once: true });
      onQueued?.(queue.length);
    });

    try {
      return await task();
    } finally {
      const queue = this.#queues.get(profileId);
      const next = queue?.shift();
      if (queue?.length === 0) this.#queues.delete(profileId);
      if (next) next.start();
      else this.#running.set(profileId, Math.max(0, (this.#running.get(profileId) ?? 1) - 1));
    }
  }

  validateExclusiveSiblingBatch(
    toolNames: readonly string[],
    exclusiveTools: ReadonlySet<string>,
  ): void {
    if (toolNames.some((tool) => exclusiveTools.has(tool)) && toolNames.length > 1)
      throw new Error("An exclusive subagent tool cannot run beside sibling tools");
  }

  shutdown(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const error = new Error("Subagent scheduler is shut down");
    for (const queue of this.#queues.values()) {
      for (const entry of queue) {
        entry.removeAbort();
        entry.reject(error);
      }
    }
    this.#queues.clear();
  }
}

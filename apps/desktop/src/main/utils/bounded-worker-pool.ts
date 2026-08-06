/**
 * Shared-cursor worker pool — N workers pull from a shared index.
 * Structurally immune to TOCTOU (no separate check-then-act).
 * Same idiom as discovery-orchestrator's fanoutWorker / sweep worker.
 */
export async function runBoundedWorkerPool<T>(opts: {
  items: readonly T[];
  concurrency: number;
  run: (item: T, index: number) => Promise<void>;
  checkAborted?: () => void;
}): Promise<void> {
  const { items, concurrency, run, checkAborted } = opts;
  let nextIdx = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      checkAborted?.();
      const idx = nextIdx++;
      if (idx >= items.length) return;
      await run(items[idx], idx);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

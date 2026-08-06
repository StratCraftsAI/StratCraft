/**
 * Iterate listeners in an isolation boundary: one listener throwing
 * must never kill sibling listeners or the caller.
 */
export function safeForEach<T extends (...args: never[]) => void>(
  listeners: Iterable<T>,
  tag: string,
  ...args: Parameters<T>
): void {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch (error) {
      console.error(`${tag}`, error);
    }
  }
}

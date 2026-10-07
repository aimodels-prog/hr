/** A synchronous lock: React state alone cannot stop two clicks in the same render. */
export function createSubmissionLock() {
  let pending = false;
  return {
    get pending() {
      return pending;
    },
    run<T>(action: () => T): T | undefined {
      if (pending) return undefined;
      pending = true;
      try {
        const result = action();
        if (result && typeof (result as unknown as PromiseLike<unknown>).then === "function") {
          return Promise.resolve(result).finally(() => {
            pending = false;
          }) as T;
        }
        pending = false;
        return result;
      } catch (error) {
        pending = false;
        throw error;
      }
    },
  };
}

/** Bound a UI wait without treating a failed request as an empty result. */
export async function withRequestTimeout<T>(
  request: Promise<T>,
  message: string,
  milliseconds = 20_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withEnv(
  updates: Record<string, string | undefined>,
  fn: () => Promise<void>
): Promise<void> {
  const previous = Object.fromEntries(
    Object.keys(updates).map((key) => [key, process.env[key]])
  ) as Record<string, string | undefined>;

  for (const [key, value] of Object.entries(updates)) {
    restoreEnv(key, value);
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      restoreEnv(key, value);
    }
  }
}

export async function withMockedFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response,
  fn: () => Promise<void>
): Promise<void> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => handler(input, init);

  try {
    await fn();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

export function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

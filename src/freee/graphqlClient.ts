import { GraphQLClient } from "graphql-request";

export type GraphQLAuth = { token: string };

export function createGraphQLClient(opts: {
  endpoint: string;
  auth: GraphQLAuth;
  timeoutMs: number;
}): GraphQLClient {
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.auth.token}`,
  };

  const client = new GraphQLClient(opts.endpoint, {
    headers,
    fetch: (url, init) => {
      const nextInit: RequestInit = { ...(init ?? {}) };
      // Node 18+ fetch supports AbortSignal.timeout
      nextInit.signal = AbortSignal.timeout(opts.timeoutMs);
      return fetch(url, nextInit);
    },
  });

  return client;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number } = {
    retries: 3,
    baseDelayMs: 300,
  },
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt += 1;
      if (attempt > opts.retries) throw e;
      const wait = opts.baseDelayMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

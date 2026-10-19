import { authProviderFromEnv, type AuthProvider } from "../../../../packages/pms-client/src/AuthProvider.js";
import { AuthStore } from "./AuthStore.js";

export interface EnvironmentAuth {
  baseUrl: string;
  auth: AuthProvider;
  source: "PMS_AUTH_TOKEN";
}

/**
 * Returns an explicit, process-local access-token provider for CI or a
 * restricted terminal. The token is never persisted or included in output.
 */
export function environmentAuth(env: Record<string, string | undefined>): EnvironmentAuth | null {
  if (!env.PMS_AUTH_TOKEN?.trim()) return null;
  const rawBaseUrl = env.PMS_BASE_URL?.trim() || "http://localhost:5173/api";
  return {
    baseUrl: AuthStore.normalizeBaseUrl(rawBaseUrl),
    auth: authProviderFromEnv(env, "PMS_AUTH_TOKEN"),
    source: "PMS_AUTH_TOKEN",
  };
}

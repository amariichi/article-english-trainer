import type { AppContext } from "../types/appContext.js";
import type { LlmProvider } from "./types.js";

export function resolveProvider(context: AppContext, requestedProvider?: LlmProvider): LlmProvider {
  if (!requestedProvider || requestedProvider === context.env.LLM_PROVIDER) {
    return requestedProvider ?? context.env.LLM_PROVIDER;
  }

  if (!context.env.ALLOW_PROVIDER_OVERRIDE) {
    throw new Error("Provider override is disabled. Set ALLOW_PROVIDER_OVERRIDE=true to enable it.");
  }

  return requestedProvider;
}

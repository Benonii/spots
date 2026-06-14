/**
 * Provider-agnostic LLM model resolver.
 *
 * The Vercel AI SDK's `generateObject` is provider-neutral — only the model
 * factory differs per provider. Selection is pure config: set
 *   LLM_MODEL = "<provider>:<model-id>"   (provider ∈ openai | google)
 * and supply the key as either the generic LLM_API_KEY or the provider's native
 * env var (OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY). Switching from one
 * provider to the other needs no code change.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { getEnv, requireKeys } from "../env.ts";

const PROVIDERS = ["openai", "google"] as const;
type Provider = (typeof PROVIDERS)[number];

function parseModelSpec(spec: string): { provider: Provider; modelId: string } {
  const sep = spec.indexOf(":");
  const provider = spec.slice(0, sep);
  const modelId = spec.slice(sep + 1);
  if (sep === -1 || !modelId || !PROVIDERS.includes(provider as Provider)) {
    throw new Error(
      `LLM_MODEL must be "<provider>:<model-id>" with provider ∈ ${PROVIDERS.join(
        " | ",
      )} (got "${spec}").`,
    );
  }
  return { provider: provider as Provider, modelId };
}

const NATIVE_KEY_ENV: Record<Provider, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** Generic LLM_API_KEY wins; otherwise fall back to the provider's native env var. */
function resolveApiKey(provider: Provider): string {
  const key = getEnv().LLM_API_KEY ?? process.env[NATIVE_KEY_ENV[provider]];
  if (!key) {
    throw new Error(
      `Missing LLM API key — set LLM_API_KEY or ${NATIVE_KEY_ENV[provider]} in .env.`,
    );
  }
  return key;
}

/** Resolve the configured language model. Throws if LLM env is missing/invalid. */
export function getModel(): LanguageModel {
  requireKeys("LLM_MODEL");
  const { provider, modelId } = parseModelSpec(getEnv().LLM_MODEL!);
  const apiKey = resolveApiKey(provider);

  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
  }
}

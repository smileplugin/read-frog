import type { ProviderConfig } from "@/types/config/provider"

export const CODEX_BRIDGE_URL = "http://127.0.0.1:19827/v1"
// The companion has a 120s deadline. Allow time for its final response to arrive.
export const CODEX_TRANSLATION_TIMEOUT_MS = 125_000

export function isCodexBridgeProvider(provider: ProviderConfig | null): boolean {
  return provider?.provider === "openai-compatible" && provider.baseURL === CODEX_BRIDGE_URL
}

export function getCodexTranslationTimeoutMs(
  provider: ProviderConfig | null,
  normalTimeoutMs: number,
): number {
  return isCodexBridgeProvider(provider)
    ? Math.max(normalTimeoutMs, CODEX_TRANSLATION_TIMEOUT_MS)
    : normalTimeoutMs
}

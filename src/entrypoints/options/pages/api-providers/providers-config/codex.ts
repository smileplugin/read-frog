import type { APIProviderConfig, ProvidersConfig } from "@/types/config/provider"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { getUniqueName } from "@/utils/name"
import { CODEX_BRIDGE_URL } from "@/utils/providers/codex-bridge"

export { CODEX_BRIDGE_URL, isCodexBridgeProvider } from "@/utils/providers/codex-bridge"

export function createCodexProvider(
  providers: ProvidersConfig,
  token: string,
  model: string,
): APIProviderConfig {
  if (token.trim().length < 32 || !/^[\w./:-]{1,160}$/.test(model)) {
    throw new Error("Invalid Codex bridge configuration")
  }
  return {
    id: getRandomUUID(),
    provider: "openai-compatible",
    name: getUniqueName("Codex", new Set(providers.map((provider) => provider.name))),
    description: "ChatGPT / Codex subscription · local bridge",
    enabled: true,
    baseURL: CODEX_BRIDGE_URL,
    apiKey: token.trim(),
    model: { model: "use-custom-model", isCustomModel: true, customModel: model },
  }
}

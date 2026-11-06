import { describe, expect, it } from "vitest"
import { apiProviderConfigItemSchema } from "@/types/config/provider"
import { CODEX_BRIDGE_URL, createCodexProvider, isCodexBridgeProvider } from "../codex"

describe("Codex subscription preset", () => {
  it("persists a schema-valid custom provider with a local token and chosen model", () => {
    const provider = createCodexProvider([], `  ${"x".repeat(64)}  `, "available-codex-model")
    expect(apiProviderConfigItemSchema.safeParse(provider).success).toBe(true)
    expect(provider).toMatchObject({
      provider: "openai-compatible",
      baseURL: CODEX_BRIDGE_URL,
      apiKey: "x".repeat(64),
      model: { customModel: "available-codex-model", isCustomModel: true },
    })
    expect(isCodexBridgeProvider(provider)).toBe(true)
  })

  it("preserves existing providers and assigns a unique name and id", () => {
    const existing = createCodexProvider([], "x".repeat(64), "model-a")
    const next = createCodexProvider([existing], "y".repeat(64), "model-b")
    expect(next.name).not.toBe(existing.name)
    expect(next.id).not.toBe(existing.id)
    expect(existing.name).toBe("Codex")
  })

  it("refuses an empty token or invalid model", () => {
    expect(() => createCodexProvider([], "", "model")).toThrow()
    expect(() => createCodexProvider([], "x".repeat(64), "")).toThrow()
  })
})

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { i18n } from "@/utils/i18n"
import { CODEX_BRIDGE_URL } from "./codex"

export function CodexSubscriptionSetup({
  onAdd,
}: {
  onAdd: (token: string, model: string) => Promise<void>
}) {
  const [token, setToken] = useState("")
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  const connect = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError("")
    setModels([])
    setModel("")
    try {
      const response = await fetch(`${CODEX_BRIDGE_URL}/models`, {
        headers: { Authorization: `Bearer ${token.trim()}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        credentials: "omit",
      })
      if (!response.ok) throw new Error("Bridge connection failed")
      const body: unknown = await response.json()
      if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) {
        throw new Error("Invalid model list")
      }
      const available = body.data.filter(
        (entry): entry is { id: string; isDefault?: boolean } =>
          !!entry && typeof entry === "object" && typeof entry.id === "string",
      )
      if (!available.length) throw new Error("No Codex models available")
      if (controller.signal.aborted) return
      setModels(available.map((entry) => entry.id))
      setModel((available.find((entry) => entry.isDefault) ?? available[0]).id)
    } catch {
      if (!controller.signal.aborted) setError(i18n.t("codexSubscription.connectionError"))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const add = async () => {
    setBusy(true)
    setError("")
    try {
      await onAdd(token.trim(), model)
    } catch {
      setError(i18n.t("codexSubscription.saveError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="my-2 rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">{i18n.t("codexSubscription.title")}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{i18n.t("codexSubscription.description")}</p>
        <p className="text-sm">{i18n.t("codexSubscription.setup")}</p>
        <pre className="overflow-x-auto rounded bg-muted p-2 text-sm">
          {"pnpm codex:login\npnpm codex:bridge"}
        </pre>
        <label className="flex flex-col gap-2 text-sm">
          {i18n.t("codexSubscription.token")}
          <Input
            type="password"
            autoComplete="off"
            value={token}
            disabled={busy}
            onChange={(event) => {
              setToken(event.target.value)
              setModels([])
              setModel("")
              setError("")
            }}
          />
        </label>
        <Button type="button" disabled={busy || token.trim().length < 32} onClick={connect}>
          {i18n.t("codexSubscription.connect")}
        </Button>
        {models.length > 0 && (
          <>
            <label className="flex flex-col gap-2 text-sm">
              {i18n.t("codexSubscription.model")}
              <select
                className="rounded border bg-background p-2"
                value={model}
                disabled={busy}
                onChange={(event) => setModel(event.target.value)}
              >
                {models.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" disabled={busy || !model} onClick={add}>
              {i18n.t("codexSubscription.add")}
            </Button>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  )
}

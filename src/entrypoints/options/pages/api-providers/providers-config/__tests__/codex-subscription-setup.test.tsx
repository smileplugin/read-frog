// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CodexSubscriptionSetup } from "../codex-subscription-setup"

afterEach(() => vi.unstubAllGlobals())

function setup(onAdd = vi.fn(async () => {})) {
  render(<CodexSubscriptionSetup onAdd={onAdd} />)
  fireEvent.click(screen.getByText("codexSubscription.title"))
  fireEvent.change(screen.getByLabelText("codexSubscription.token"), {
    target: { value: "x".repeat(64) },
  })
  return onAdd
}

describe("Codex subscription setup", () => {
  it("loads account models and saves the selected model with the local token", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "model-a" }, { id: "model-b", isDefault: true }],
          }),
        ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const onAdd = setup()
    fireEvent.click(screen.getByRole("button", { name: "codexSubscription.connect" }))
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("model-b"))
    expect(fetchMock.mock.calls[0]).toEqual([
      "http://127.0.0.1:19827/v1/models",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${"x".repeat(64)}` },
        credentials: "omit",
      }),
    ])
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "model-a" } })
    fireEvent.click(screen.getByRole("button", { name: "codexSubscription.add" }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("x".repeat(64), "model-a"))
  })

  it("shows a connection error and prevents adding an unauthenticated provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 502 })),
    )
    const onAdd = setup()
    fireEvent.click(screen.getByRole("button", { name: "codexSubscription.connect" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("codexSubscription.connectionError")
    expect(screen.queryByRole("button", { name: "codexSubscription.add" })).not.toBeInTheDocument()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it("invalidates discovered models after the token changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "model-a" }] }))),
    )
    setup()
    fireEvent.click(screen.getByRole("button", { name: "codexSubscription.connect" }))
    await screen.findByRole("combobox")
    fireEvent.change(screen.getByLabelText("codexSubscription.token"), {
      target: { value: "y".repeat(64) },
    })
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "codexSubscription.add" })).not.toBeInTheDocument()
  })
})

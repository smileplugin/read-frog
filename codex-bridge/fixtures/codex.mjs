#!/usr/bin/env node
import { createInterface } from "node:readline"
const send = (message) => console.log(JSON.stringify(message))
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line)
  const reply = (result) => send({ id, result })
  if (method === "initialize") reply({})
  if (method === "account/read")
    reply({ account: { type: process.env.TEST_CODEX_ACCOUNT || "chatgpt" } })
  if (method === "model/list")
    reply({ data: [{ model: "fixture-model", isDefault: true }], nextCursor: null })
  if (method === "thread/start") {
    if (params.sandbox !== "read-only" || params.approvalPolicy !== "never" || !params.ephemeral) {
      send({ id, error: { message: "Unsafe thread configuration" } })
      return
    }
    reply({ thread: { id: "fixture-thread" } })
  }
  if (method === "turn/start") {
    reply({ turn: { id: "fixture-turn" } })
    if (process.env.TEST_CODEX_HANG) return
    const content = params.outputSchema ? '{"translated":"你好"}' : "你好"
    const event = (eventMethod, extra) =>
      send({ method: eventMethod, params: { threadId: params.threadId, ...extra } })
    event("item/started", {
      item: {
        id: "input",
        type: process.env.TEST_CODEX_ITEM || "userMessage",
        content: params.input,
      },
    })
    event("item/started", { item: { id: "commentary", type: "agentMessage", phase: "commentary" } })
    event("item/agentMessage/delta", { itemId: "commentary", delta: "Thinking..." })
    event("item/started", { item: { id: "final", type: "agentMessage", phase: "final_answer" } })
    event("item/agentMessage/delta", { itemId: "final", delta: content })
    event("item/completed", {
      item: { id: "final", type: "agentMessage", text: content, phase: "final_answer" },
    })
    event("turn/completed", { turn: { status: "completed" } })
  }
})

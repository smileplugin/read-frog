import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, after } from "node:test"
import { fileURLToPath } from "node:url"

const home = await mkdtemp(join(tmpdir(), "read-frog-test-home-"))
process.env.READ_FROG_CODEX_HOME = home
process.env.READ_FROG_CODEX_BIN = fileURLToPath(new URL("./fixtures/codex.mjs", import.meta.url))
const { createCodexClient } = await import("./client.mjs")
after(() => rm(home, { recursive: true, force: true }))

test("uses the HTTP-only subscription provider for process setup and translation threads", async () => {
  process.env.TEST_CODEX_REQUIRE_HTTP = "1"
  let client
  try {
    client = await createCodexClient()
    assert.equal(
      await client.complete({
        model: "fixture-model",
        messages: [{ role: "user", content: "hello" }],
      }),
      "你好",
    )
  } finally {
    delete process.env.TEST_CODEX_REQUIRE_HTTP
    client?.close()
  }
})

test("accepts the userMessage lifecycle event emitted by real Codex turns", async () => {
  const client = await createCodexClient()
  try {
    assert.equal(
      await client.complete({
        model: "fixture-model",
        messages: [{ role: "user", content: "hello" }],
      }),
      "你好",
    )
  } finally {
    client.close()
  }
})

test("still rejects actual tool execution events", async () => {
  process.env.TEST_CODEX_ITEM = "commandExecution"
  const client = await createCodexClient()
  delete process.env.TEST_CODEX_ITEM
  try {
    await assert.rejects(
      client.complete({ model: "fixture-model", messages: [{ role: "user", content: "hello" }] }),
      /attempted a tool call/,
    )
  } finally {
    client.close()
  }
})

test("performs the app-server handshake, loads models and streams final text only", async () => {
  const client = await createCodexClient()
  try {
    assert.equal((await client.models())[0].id, "fixture-model")
    const deltas = []
    const result = await client.complete({
      model: "fixture-model",
      messages: [{ role: "user", content: "hello" }],
      onDelta: (delta) => deltas.push(delta),
    })
    assert.equal(result, "你好")
    assert.deepEqual(deltas, ["你好"])
  } finally {
    client.close()
  }
})

test("refuses API-key accounts rather than billing them", async () => {
  process.env.TEST_CODEX_ACCOUNT = "apiKey"
  try {
    await assert.rejects(createCodexClient(), /subscription login required/)
  } finally {
    delete process.env.TEST_CODEX_ACCOUNT
  }
})

test("passes outputSchema through the actual JSON-RPC transport", async () => {
  const client = await createCodexClient()
  try {
    const text = await client.complete({
      model: "fixture-model",
      messages: [],
      schema: { type: "object" },
    })
    assert.deepEqual(JSON.parse(text), { translated: "你好" })
  } finally {
    client.close()
  }
})

test("terminates a stalled Codex turn at the deadline", async () => {
  process.env.TEST_CODEX_HANG = "1"
  const client = await createCodexClient({ timeoutMs: 500 })
  delete process.env.TEST_CODEX_HANG
  try {
    await assert.rejects(
      client.complete({ model: "fixture-model", messages: [] }),
      /cancelled or timed out/,
    )
  } finally {
    client.close()
  }
})

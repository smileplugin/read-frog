import { spawn } from "node:child_process"
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { createServer } from "node:http"
import { pathToFileURL } from "node:url"
import { codexHome, createCodexClient } from "./client.mjs"

export function validateRequest(body) {
  if (!body || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100)
    throw new Error("messages must contain 1–100 text messages.")
  if (typeof body.model !== "string" || !/^[\w./:-]{1,160}$/.test(body.model))
    throw new Error("A valid Codex model is required.")
  for (const message of body.messages) {
    if (!["system", "developer", "user", "assistant"].includes(message.role))
      throw new Error("Only text conversation roles are supported.")
    if (Array.isArray(message.content)) {
      if (message.content.some((part) => part.type !== "text" || typeof part.text !== "string"))
        throw new Error("Only text content is supported.")
      message.content = message.content.map((part) => part.text).join("\n")
    }
    if (typeof message.content !== "string") throw new Error("Only text content is supported.")
  }
  if (body.tools?.length || body.tool_choice || (body.n !== undefined && body.n !== 1))
    throw new Error("Tools and multiple completions are unsupported.")
  if (
    body.response_format &&
    !["text", "json_schema", "json_object"].includes(body.response_format.type)
  )
    throw new Error("Unsupported response format.")
  if (
    body.response_format?.type === "json_schema" &&
    (!body.response_format.json_schema?.schema ||
      typeof body.response_format.json_schema.schema !== "object")
  )
    throw new Error("JSON schema is required.")
  return body
}

export function createBridge({ token, createClient = createCodexClient, maxConcurrent = 2 } = {}) {
  if (!token || token.length < 32)
    throw new Error("A local bridge token of at least 32 characters is required.")
  let active = 0
  const expectedAuth = Buffer.from(`Bearer ${token}`)
  return createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      res.end(JSON.stringify(data))
    }
    // Reject DNS rebinding and website origins. CORS never grants access to webpages.
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || "")) {
      json(403, { error: { message: "Loopback host required." } })
      return
    }
    const origin = req.headers.origin
    if (
      origin &&
      !/^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f\d-]{36})$/.test(origin)
    ) {
      json(403, { error: { message: "Browser extension origin required." } })
      return
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin)
      res.setHeader("Vary", "Origin")
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Private-Network": "true",
      })
      res.end()
      return
    }
    const auth = Buffer.from(req.headers.authorization || "")
    if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) {
      json(401, { error: { message: "Invalid local bridge token." } })
      return
    }
    if (
      !(req.method === "GET" && req.url === "/v1/models") &&
      !(req.method === "POST" && req.url === "/v1/chat/completions")
    ) {
      json(404, { error: { message: "Unknown endpoint." } })
      return
    }
    if (active >= maxConcurrent) {
      res.setHeader("Retry-After", "2")
      json(429, { error: { message: "Codex bridge is busy. Retry shortly." } })
      return
    }
    active++
    const controller = new AbortController()
    res.on("close", () => controller.abort())
    let client
    let status = 502
    try {
      let body
      if (req.method === "POST") {
        status = 400
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new Error("Content-Type must be application/json.")
        let size = 0
        const chunks = []
        for await (const chunk of req) {
          size += chunk.length
          if (size > 256_000) {
            status = 413
            throw new Error("Request exceeds 256 KB limit.")
          }
          chunks.push(chunk)
        }
        body = validateRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      }
      status = 502
      client = await createClient({ signal: controller.signal })
      if (req.method === "GET") {
        json(200, { object: "list", data: await client.models() })
        return
      }
      const id = `chatcmpl-${randomUUID()}`
      const created = Math.floor(Date.now() / 1000)
      const stream = body.stream === true
      const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
      const chunk = (delta, finish = null) => ({
        id,
        object: "chat.completion.chunk",
        created,
        model: body.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })
      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        })
        send(chunk({ role: "assistant", content: "" }))
      }
      let streamed = false
      const schema =
        body.response_format?.type === "json_schema"
          ? body.response_format.json_schema.schema
          : undefined
      const messages =
        body.response_format?.type === "json_object"
          ? [{ role: "system", content: "Return a valid JSON object only." }, ...body.messages]
          : body.messages
      const text = await client.complete({
        model: body.model,
        messages,
        schema,
        onDelta: stream
          ? (delta) => {
              streamed = true
              send(chunk({ content: delta }))
            }
          : undefined,
      })
      if (body.response_format?.type === "json_object") JSON.parse(text)
      if (stream) {
        if (!streamed) send(chunk({ content: text }))
        send(chunk({}, "stop"))
        res.end("data: [DONE]\n\n")
      } else {
        json(200, {
          id,
          object: "chat.completion",
          created,
          model: body.model,
          choices: [
            { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
          ],
        })
      }
    } catch (error) {
      if (res.destroyed) return
      // Validation and bridge-owned errors contain no prompts or credentials.
      const message =
        error instanceof SyntaxError ? "Invalid JSON in request or Codex response." : error.message
      if (res.headersSent)
        res.end(
          `data: ${JSON.stringify({ error: { message, type: "codex_bridge_error" } })}\n\ndata: [DONE]\n\n`,
        )
      else json(status, { error: { message, type: "codex_bridge_error" } })
    } finally {
      client?.close()
      active--
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--login")) {
    await mkdir(codexHome, { recursive: true, mode: 0o700 })
    const child = spawn(process.env.READ_FROG_CODEX_BIN || "codex", ["login"], {
      env: { ...process.env, CODEX_HOME: codexHome, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
      stdio: "inherit",
    })
    child.on("error", () => {
      console.error("Please install the Codex CLI first.")
      process.exitCode = 1
    })
    child.on("exit", (code) => {
      process.exitCode = code ?? 1
    })
  } else {
    const token = process.env.READ_FROG_CODEX_BRIDGE_TOKEN || randomBytes(32).toString("hex")
    const port = Number(process.env.READ_FROG_CODEX_PORT || 19827)
    const server = createBridge({ token })
    server.requestTimeout = 30_000
    server.on("error", (error) => {
      console.error(`Cannot start Codex bridge: ${error.code}`)
      process.exitCode = 1
    })
    server.listen(port, "127.0.0.1", () => {
      console.log(
        `陪读蛙 Codex 桥接已启动：http://127.0.0.1:${port}/v1\n本地连接密钥（不是 OpenAI API Key）：${token}\n请在扩展的“添加服务商 → Codex 订阅”中填写此密钥。\n首次使用先运行 pnpm codex:login，通过 ChatGPT 登录。`,
      )
    })
    for (const event of ["SIGINT", "SIGTERM"])
      process.on(event, () => {
        server.closeAllConnections()
        server.close()
      })
  }
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request } from 'node:http'
import { createBridge } from './server.mjs'

const token = 'a'.repeat(64)
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const requestBody = { model: 'test-model', messages: [{ role: 'user', content: 'Translate hello' }] }

async function bridge(t, overrides = {}) {
  const calls = []
  let closed = 0
  const server = createBridge({ token, createClient: async () => ({
    models: async () => [{ id: 'test-model', isDefault: true }],
    complete: async input => { calls.push(input); input.onDelta?.('你好'); return '你好' },
    close: () => { closed++ },
  }), ...overrides })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (body, customHeaders = headers) => fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: customHeaders, body: JSON.stringify(body) })
  return { base, post, calls, get closed() { return closed } }
}

test('requires the local token and rejects website origins and DNS rebinding', async t => {
  const b = await bridge(t)
  assert.equal((await fetch(`${b.base}/v1/models`)).status, 401)
  assert.equal((await fetch(`${b.base}/v1/models`, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403)
  const reboundStatus = await new Promise((resolve, reject) => {
    const req = request(`${b.base}/v1/models`, { headers: { ...headers, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject)
    req.end()
  })
  assert.equal(reboundStatus, 403)
  const models = await fetch(`${b.base}/v1/models`, { headers })
  assert.equal((await models.json()).data[0].id, 'test-model')
})

test('permits extension preflight without allowing arbitrary websites', async t => {
  const b = await bridge(t)
  const origin = `chrome-extension://${'a'.repeat(32)}`
  const res = await fetch(`${b.base}/v1/models`, { method: 'OPTIONS', headers: { Origin: origin } })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), origin)
})

test('translates text and preserves application message roles', async t => {
  const b = await bridge(t)
  const res = await b.post({ ...requestBody, messages: [{ role: 'system', content: 'Return Chinese' }, { role: 'user', content: [{ type: 'text', text: 'hello' }] }] })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).choices[0].message.content, '你好')
  assert.deepEqual(b.calls[0].messages, [{ role: 'system', content: 'Return Chinese' }, { role: 'user', content: 'hello' }])
  assert.equal(b.closed, 1)
})

test('returns OpenAI-compatible SSE with final stop and DONE', async t => {
  const b = await bridge(t)
  const res = await b.post({ ...requestBody, stream: true })
  assert.match(res.headers.get('content-type'), /text\/event-stream/)
  const stream = await res.text()
  assert.match(stream, /你好/)
  assert.match(stream, /"finish_reason":"stop"/)
  assert.match(stream, /data: \[DONE\]/)
})

test('forwards structured output schemas to Codex', async t => {
  let actualSchema
  const b = await bridge(t, { createClient: async () => ({
    complete: async ({ schema }) => { actualSchema = schema; return '{"word":"hello"}' }, close() {},
  }) })
  const schema = { type: 'object', properties: { word: { type: 'string' } }, required: ['word'], additionalProperties: false }
  const res = await b.post({ ...requestBody, response_format: { type: 'json_schema', json_schema: { name: 'word', schema } } })
  assert.equal(res.status, 200)
  assert.deepEqual(actualSchema, schema)
  assert.equal(JSON.parse((await res.json()).choices[0].message.content).word, 'hello')
})

test('rejects unsupported inputs before starting Codex', async t => {
  const b = await bridge(t, { createClient: async () => { assert.fail('Must not start Codex') } })
  for (const body of [
    { ...requestBody, tools: [{ type: 'function' }] },
    { ...requestBody, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: {} }] }] },
    { ...requestBody, response_format: { type: 'json_schema' } },
    { ...requestBody, messages: [] },
    { ...requestBody, model: '../malicious model' },
  ]) assert.equal((await b.post(body)).status, 400)
  assert.equal((await b.post({ ...requestBody, messages: [{ role: 'user', content: 'x'.repeat(256_001) }] })).status, 413)
})

test('reports upstream errors without a successful completion', async t => {
  const b = await bridge(t, { createClient: async () => { throw new Error('ChatGPT subscription login required.') } })
  const res = await b.post(requestBody)
  assert.equal(res.status, 502)
  assert.match((await res.json()).error.message, /subscription/)
})

test('limits concurrent work and aborts Codex on client disconnect', async t => {
  let resolveStarted
  let resolveAborted
  const started = new Promise(resolve => { resolveStarted = resolve })
  const aborted = new Promise(resolve => { resolveAborted = resolve })
  const b = await bridge(t, { maxConcurrent: 1, createClient: async ({ signal }) => ({
    complete: () => new Promise((resolve, reject) => {
      resolveStarted()
      signal.addEventListener('abort', () => { resolveAborted(); reject(new Error('cancelled')) }, { once: true })
    }), close() {},
  }) })
  const controller = new AbortController()
  const first = fetch(`${b.base}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify(requestBody), signal: controller.signal }).catch(() => {})
  await started
  assert.equal((await b.post(requestBody)).status, 429)
  controller.abort()
  await aborted
  await first
})

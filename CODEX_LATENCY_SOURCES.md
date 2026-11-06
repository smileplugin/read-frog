# Codex 翻译延迟调研与实测（2026-11-06）

## 结论

当前环境下，**WebSocket 连接失败后的多轮重试是一个已经用对照实验证实的主要延迟来源**。桥接原先每次请求启动新 app-server，并为翻译创建新会话，反复进入该连接恢复流程。改为使用保留 ChatGPT 认证的 HTTP/SSE 传输后，重试消失，三种真实端到端请求分别在约 4–7 秒内完成。

此前记录的 116–118 秒请求没有保留分段日志，所以不能事后证明其全部耗时都由 WebSocket 引起。当前复测的默认路径为 11.7–26.3 秒，也说明网络和连接状态会造成变化。不能把先前的总耗时直接归因于模型本身，也不能将小样本结果当成长期延迟保证。

## 方法与数据

- macOS，Node.js 25.1.0，官方 Codex CLI 0.164.0，真实 ChatGPT 登录，模型 `gpt-6-luna`。
- 所有对照使用同一句话、相同翻译指令，未调整 reasoning effort；访问令牌仅在本机临时隔离目录使用，结束后删除。
- 在 CLI 进程边界记录 JSON-RPC 方法、事件类型、时间、重试标志和 Token 数量。不记录令牌、认证头或完整请求载荷。
- 除传输配置外保持相同参数。每组两个请求复用进程，但各自建立独立的临时 thread；最后三次端到端请求通过正式 HTTP 桥接，每次重新启动 CLI。

| 场景                                     | 首个文本增量 | 翻译完成  | 可恢复错误通知 |
| ---------------------------------------- | ------------ | --------- | -------------- |
| 原默认传输，第 1 次                      | 10.985 秒    | 11.651 秒 | 4 次           |
| 原默认传输，第 2 次（同进程、新 thread） | 25.750 秒    | 26.337 秒 | 4 次           |
| 临时 HTTP-only 对照，第 1 次             | 2.967 秒     | 3.678 秒  | 0              |
| 临时 HTTP-only 对照，第 2 次             | 3.731 秒     | 4.342 秒  | 0              |
| 正式修复代码，第 1 次                    | 5.193 秒     | 5.776 秒  | 0              |
| 正式修复代码，第 2 次                    | 5.149 秒     | 6.171 秒  | 0              |

最后通过正式桥接进行三种请求的端到端检查：

| 请求类型    | HTTP 状态 | 完整耗时 | 结果                                              |
| ----------- | --------- | -------- | ------------------------------------------------- |
| 普通翻译    | 200       | 7.190 秒 | 返回有效中文译文                                  |
| 流式翻译    | 200       | 3.966 秒 | 3.958 秒收到首个文本增量，正常 `stop` 与 `[DONE]` |
| JSON schema | 200       | 7.071 秒 | 返回可解析 JSON，包含中文 `translation` 字段      |

## 如何排除其他嫌疑

1. **不是进程启动本身消耗两分钟。** 原默认路径的首轮 trace 中，`initialize` 约 0.136 秒；`account/read` 约 0.874 秒；`model/list` 约 4.023 秒；`thread/start` 约 0.097 秒。模型列表有独立成本，但不足以解释先前总耗时。
2. **不是这几次请求消耗了大量推理 Token。** 默认路径、HTTP 对照、正式修复的各两次生成，`reasoningOutputTokens` 均为 0。模型目录显示 `gpt-6-luna` 的默认 effort 是 `medium`，但这里没有证据证明推理是瓶颈，因此未靠修改 effort 来宣称提速。
3. **不是最终文本生成后又被桥接压住很久。** 默认路径首个文本到完成约 0.7 秒，正式修复约 0.6–1.0 秒；端到端流式请求的首个内容与完成相差约 8 毫秒。主要等待在首个文本之前。
4. **仅复用进程不够。** 默认传输同进程的第二个独立 thread 仍出现 WebSocket 失败和 4 次可恢复错误，耗时反而增加。这不等于同一个 thread 的连接复用无效，而是说明当前“每次独立翻译会话”的设计不能仅靠进程池规避故障。
5. **连接错误有直接证据。** 默认组记录到 15 条带 WebSocket 失败标签的 stderr 日志，以及 8 条 `responseStreamDisconnected`、`willRetry=true` 通知；两组 HTTP 路径都没有这些事件。只保存标签与错误类型，未保存原始 stderr 内容。

补充可证伪检查：在修复后的同一自定义 provider 上，仅恢复 `supports_websockets=true`，再次出现多轮连接失败；脱敏后的具体原因是 `Connection reset by peer (os error 54)`，该次翻译耗时 15.002 秒。这进一步确认传输开关与故障相关，但不能据此唯一定位是代理、防火墙、中间网络还是服务端重置了连接。

## 第一方文档和源码依据

- 官方配置支持 `model_providers.<id>.supports_websockets`，并列出 HTTP 请求重试、流式重试与空闲超时设置。[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)
- 对应 0.164.0 的源码中，WebSocket 连接默认超时是 15 秒，stream 重试默认 5、HTTP request 重试默认 4、stream idle 默认 300 秒。它们是连接与恢复预算，不能简单相乘后宣称所有请求固定等待某个时间。[model-provider-info 源码](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/model-provider-info/src/lib.rs#L68)
- 模型客户端根据 provider 的 `supports_websockets` 与会话回退状态决定是否启用 WebSocket；直接关闭该能力会跳过该路径，继续使用 HTTP Responses 传输。[传输开关](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/client.rs#L1143)、[HTTP 回退路径](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/client.rs#L2383)
- WebSocket 预热会参与连接尝试与恢复，回退状态属于会话。新的会话可能重新承受连接失败；这与实测新 thread 再次重试一致。[客户端的生命周期说明](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/client.rs#L1)、[会话级回退状态](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/client.rs#L256)
- `requires_openai_auth=true` 的 provider 可以继续使用 Codex 管理的 ChatGPT 认证；该改动没有引入 API Key，桥接仍检查 `account.type === "chatgpt"`。[认证路径源码](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/model-provider/src/provider.rs#L335)、[账号类型映射](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/model-provider/src/provider.rs#L518)

## 落地改动与边界

- 新增独立 provider ID `read-frog-codex`，设置 `requires_openai_auth=true`、`supports_websockets=false`，进程和 thread 均选择同一 provider。0.164.0 会拒绝覆盖内置 `openai` provider，因此使用独立名称。
- HTTP 仍然支持 SSE 流式输出；这里只避开模型上游的 WebSocket 握手，不改变浏览器端的流式协议。
- 保留独立临时会话与原有工具限制，未为了复用连接把不同网页的内容混入同一个对话。
- 保留 125 秒扩展队列等待时间作为异常网络下的上限；延长超时是容错，不是这次提速的原因。
- 添加进程配置和 thread provider 一致性的回归测试，并保留真实接口测试与浏览器内整页、字幕播放体验之间的验证边界。

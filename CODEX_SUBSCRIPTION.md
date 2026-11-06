# 陪读蛙：Codex 订阅接入

本 fork 在上游陪读蛙中新增 **添加服务商 → Codex 订阅（本地桥接）**。使用你自己的 ChatGPT 订阅，通过本机官方 Codex CLI 的 `app-server` 完成文本生成，无需购买陪读蛙 AI 会员，也不需要 OpenAI API Key。

## 安装和使用

如果使用 GitHub Actions 的 `read-frog-codex-chrome` 构建包，解压后在浏览器加载 `extension/`，并在解压目录运行下面两条命令即可启动配套桥接，无需安装项目依赖。需要 Node.js 22 或更新版本，以及官方 Codex CLI：

```bash
node codex-bridge/server.mjs --login
node codex-bridge/server.mjs
```

然后从下文第 6 步配置服务商即可。如果选择从源码构建，使用以下步骤：

1. 安装官方 Codex CLI，确认终端能执行 `codex --version`。已有 Codex 桌面版不一定代表 CLI 已在 PATH 中。
2. 在本仓库目录安装依赖并构建扩展：

   ```bash
   git clone --branch feat/codex-subscription https://github.com/smileplugin/read-frog.git
   cd read-frog
   pnpm install --frozen-lockfile
   WXT_SKIP_ENV_VALIDATION=true pnpm build
   ```

   环境和包管理器版本以 `package.json` 为准。`WXT_SKIP_ENV_VALIDATION=true` 允许个人构建省略上游的 Google 登录与分析服务环境变量；这些云端功能不属于本 fork 的 Codex 验证范围。

3. Chrome / Edge 打开扩展管理页，开启开发者模式，加载 `.output/chrome-mv3`。如果使用 Edge 专用构建，则执行 `pnpm build:edge` 并加载对应输出目录。
4. 在本仓库目录运行：

   ```bash
   pnpm codex:login
   ```

   在官方登录页面登录 ChatGPT。桥接使用独立的 `~/.read-frog-codex` 目录，需要为它登录一次；不会改动现有 `~/.codex` 登录或配置。

5. 启动桥接，并保持终端运行：

   ```bash
   pnpm codex:bridge
   ```

6. 在陪读蛙设置中打开 **服务商 → 添加服务商 → Codex 订阅（本地桥接）**，粘贴终端显示的**本地连接密钥**，点击“连接并获取模型”，选择账号可用模型，点击“添加 Codex 服务商”。
7. 在设置的功能分配中，将网页翻译、字幕翻译、词典或其他需要的文本功能指定为新建的 `Codex` 服务商。添加服务商不会自动更改已有功能分配。

浏览器里只保存本地桥接密钥。OpenAI 的访问令牌和刷新令牌由本机 Codex 管理，扩展无需读取、导入 `auth.json`。

## 启停和配置

桥接默认监听 `127.0.0.1:19827`，按 `Ctrl+C` 停止。重启会生成新密钥，需要更新扩展里的连接密钥。若希望使用固定密钥，可以在自己的终端环境中设置 `READ_FROG_CODEX_BRIDGE_TOKEN`，至少 32 个字符；请勿把密钥提交到仓库。

可选环境变量：

| 变量                           | 用途                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `READ_FROG_CODEX_BIN`          | Codex CLI 可执行文件路径，默认 `codex`                                                      |
| `READ_FROG_CODEX_HOME`         | 桥接专用 Codex 目录，默认 `~/.read-frog-codex`                                              |
| `READ_FROG_CODEX_BRIDGE_TOKEN` | 固定本地连接密钥，默认每次启动随机生成                                                      |
| `READ_FROG_CODEX_PORT`         | 自定义端口，默认 `19827`；修改后需手动添加自定义 Chat Completions 服务商并填写对应 Base URL |

## 实现与范围

- 扩展复用现有 OpenAI 兼容服务商配置，不引入配置格式迁移；保存的模型 ID 来自 Codex 的 `model/list`，不硬编码模型或额度。
- 本地桥接把文本 Chat Completions 转换成官方 Codex app-server 的 JSON-RPC 请求，支持普通响应、流式 SSE 和 JSON schema 输出。每次生成使用独立的临时会话，结束后退出进程。
- 只接受 ChatGPT 订阅账号；检测到 API Key 登录会报错，不会自动切换成 API 计费。
- 请求仍受 ChatGPT / Codex 订阅额度限制。陪读蛙的云端笔记、同步和其他会员权益保持上游行为。
- 不支持图片、音频、工具调用；不会把 Codex 作为语音或图片翻译接口。温度、最大输出 Token 数等 Chat Completions 调参目前不映射到 app-server；模型使用 Codex 的默认参数。
- 仅绑定回环地址，验证本地密钥、Host 和浏览器来源；默认最多同时执行两个请求。超时或浏览器断开连接时终止对应进程。
- 桥接使用独立配置和空临时工作目录，禁用 shell、执行器、浏览器、应用和多 Agent 功能，使用只读沙箱，并拒绝客户端工具审批。

上游开源协议 GPL-3.0 保持不变。本项目是个人开源 fork，并非 OpenAI 或陪读蛙官方产品。

## 验证

```bash
pnpm test:codex-bridge
SKIP_FREE_API=true pnpm test src/entrypoints/options/pages/api-providers/providers-config/__tests__/codex.test.ts
pnpm type-check
WXT_SKIP_ENV_VALIDATION=true pnpm build
```

桥接测试使用模拟 Codex 进程与 HTTP 请求，覆盖认证、API Key 拒绝、模型发现、流式响应、结构化输出、取消与超时。

### 2026-11-06 真实订阅验证

在 macOS、Node.js 25.1.0、Codex CLI 0.164.0 上，使用本机已登录的 ChatGPT 账号，在临时隔离目录复用登录凭据，通过真实 HTTP 桥接调用 `gpt-6-luna`，未使用 OpenAI API Key。测试结束后临时凭据已删除。

| 检查             | 结果                                       | 耗时        |
| ---------------- | ------------------------------------------ | ----------- |
| 模型发现         | 返回 8 个模型                              | 约 5.8 秒   |
| 普通翻译         | HTTP 200，返回中文译文                     | 约 118.0 秒 |
| 流式翻译         | 返回增量文本、`stop` 和 `[DONE]`           | 约 116.1 秒 |
| JSON schema 输出 | HTTP 200，返回含 `translation` 字段的 JSON | 约 118.0 秒 |

普通翻译示例：`The browser extension translates web pages while keeping the original text.` → `该浏览器扩展会在保留原文的同时翻译网页。`

实测发现并修复了两个兼容问题：正常的 `userMessage` 生命周期事件被误判为工具调用；扩展队列的普通 20 秒超时会提前取消慢速 Codex 请求。现在默认端口的 Codex 服务商获得至少 125 秒的网页及字幕队列等待时间，其他服务商保留原有超时策略；回归测试覆盖这些情况。

这些结果证明真实订阅的 HTTP 文本生成链路可用。本次延迟明显偏高，原因尚未定位；未在浏览器中实测完整网页排版、视频字幕播放或大批量并发，因此不能把接口连通等同于所有浏览体验已经验证。

参考：[官方 Codex app-server 文档](https://learn.chatgpt.com/docs/app-server)、[官方认证说明](https://learn.chatgpt.com/docs/auth)。

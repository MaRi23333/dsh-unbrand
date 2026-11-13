# 参与贡献 · Contributing

**中文 | [English](#english)**

欢迎提交可复现的问题、文档改进和代码修复。先看 [README](./README.md) 的范围与限制；本插件当前只支持 DSH Desktop `0.2.2-rc.1`。

## 报告问题

请提供插件版本、Desktop 精确版本、操作系统、最小复现步骤、预期与实际行为。涉及模型选择时，用虚构供应商与模型 ID 展示规则形状，例如 `example-provider::vendor/model-a`，并说明是否已保存。

不要上传原始会话、完整配置、原始请求或完整日志。截图、错误片段和复现材料应先移除密钥、令牌、私聊、真实路径、网址中的凭据和个人标识。优先用合成输入复现；只贴与问题直接相关的脱敏片段。安全问题见 [SECURITY.md](./SECURITY.md)，不要在公开 issue 中贴出秘密或可用于攻击他人的细节。

## 本地开发

```sh
npm ci --ignore-scripts
npm test
```

源码为直接运行的 JavaScript，无构建步骤。`npm test` 使用合成数据，不调用真实模型。需要核验宿主内部入口时，可对兼容版本安装包运行离线集成检查：

```sh
npm run verify:desktop -- --asar "/absolute/path/to/app.asar"
```

该检查读取指定安装包、提取核心依赖并使用内存适配器，不启动 Desktop 或调用模型。它不替代真实宿主界面和业务验收。

提交改动时说明解决的问题、行为变化与验证结果。涉及请求改写时，覆盖未匹配模型不变、来源识别、额外操作约束保留、重复输入稳定和历史不变；界面修改检查中英文、明暗主题与窄窗口。新增兼容版本前核对实际宿主入口，不仅修改版本范围。公开材料使用虚构数据。

## English

Bug reports, documentation improvements, and fixes are welcome. Read the scope and limitations in [README.en.md](./README.en.md) first. Only DSH Desktop `0.2.2-rc.1` is currently supported.

For an issue, include the plugin version, exact Desktop version, operating system, minimal reproduction steps, expected result, and actual result. For model-selection issues, show rule syntax with fictional IDs such as `example-provider::vendor/model-a`, and state whether the settings were saved.

Do not upload raw conversations, full configurations, raw requests, or complete logs. Remove keys, tokens, private messages, real paths, credentials in URLs, and personal identifiers from screenshots and excerpts. Prefer synthetic reproductions and share only relevant, redacted excerpts. See [SECURITY.md](./SECURITY.md) for security issues; do not disclose secrets or details that enable attacks against others in a public report.

Use the commands above to install dependencies and run tests. The JavaScript runs directly with no build step. `npm test` uses synthetic data without real model calls. The optional `verify:desktop` check reads the supplied compatible `app.asar`, extracts core dependencies, and uses an in-memory adapter without starting Desktop or calling a model. It does not replace actual host UI or end-to-end acceptance.

Describe the problem, resulting behavior, and validation in your change. Request-rewriting changes should cover unmatched routes, provenance checks, preserved operational constraints, stable repeated input, and unchanged history. Check UI changes in both languages, light and dark themes, and narrow windows. Recheck the actual host entry point before extending compatibility; changing the version range alone is insufficient. Use fictional data in public materials.

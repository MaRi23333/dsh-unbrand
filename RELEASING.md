# 发布候选验证

DSH Desktop 最低版本为 `0.2.2-rc.1`，不设上限。本项目无需编译，运行文件直接进入包。

CI 运行测试和打包检查。正式 GitHub Release 发布后，publish.yml 校验 annotated 标签、包名、版本和内容，再通过 npm Trusted Publishing 自动发布并生成 provenance；预发布与已存在版本不发布。Release 附件与 npm 均来自同一审核标签。启用前需由包所有者为本仓库的 publish.yml 绑定 Trusted Publisher，无需配置长期 npm 令牌。

## 独立 checkout

在仓库根目录使用 Node.js `>=22.19.0` 和 npm：

```sh
npm ci --ignore-scripts
npm test
npm run check:pack
```

CI 在 Linux、Windows 和 Node.js `22.19.0`、`24` 运行同一组检查，只申请 `contents: read`，不保留 checkout 凭据，不需要秘密或发布令牌。锁文件为依赖来源；安装不执行依赖生命周期脚本。无需父工作区、DSH 安装目录、用户 profile、真实模型或收费请求。

`check:pack` 实际执行 `npm pack --ignore-scripts`，先核对 npm 报告，再从生成的 gzip/tar 中核对每个成员并解包。tarball 必须恰好包含下列 19 个文件：

```text
CHANGELOG.md
CONTRIBUTING.md
LICENSE
README.en.md
README.md
SECURITY.md
THIRD_PARTY_NOTICES.md
adaptive.js
assets/settings-en.png
assets/settings-zh.png
client.js
cordis.patch.yml
icon.svg
index.js
locale/en.json
locale/zh.json
package.json
policy.js
settings.js
```

中英文设置截图、贡献及安全反馈入口随包分发，以保留 README 的离线引用。检查器验证包内 Markdown 的相对文件链接均指向包内文件。其他文档、CI、检查脚本、测试、锁文件、开发依赖及本地交接不进入 tarball。检查器从解包目录导入入口和配置 schema，验证导出、固定 patch ID/包名、默认值与模型规则；解析 locale JSON、检查 SVG 元素和 PNG 头，并在模拟客户端中装载实际 `client.js`，核对语言、设置栏、图标与卸载。插件模块来自 tarball，运行依赖复制自刚由 `npm ci` 安装的锁定依赖，不要求 Windows 符号链接权限。临时 tarball、解包目录与依赖副本在结束时清理。

此 smoke 不安装或启动 DSH，不验证真实宿主渲染、模型适配器序列化、供应商缓存命中率或真实模型响应。现有单元测试验证请求投影的稳定性与边界；通过这些检查不能代替宿主验收。

## 可选：本地 Desktop 离线集成

手工指定可信的 Desktop `app.asar`，不将安装包或提取内容提交到仓库：

```sh
npm run verify:desktop -- --asar "/path/to/DSH/resources/app.asar"
```

默认只向标准输出打印报告，提取目录放在系统临时目录并在结束时清理。需要保留机器可读报告时，显式指定输出目录：

```sh
npm run verify:desktop -- --asar "/path/to/DSH/resources/app.asar" --out "/path/to/verification/desktop"
```

输出目录只保留本次成功运行的 `REPORT.json`；同名旧报告会在检查开始时移除，失败不会留下旧的成功结论。每次使用全新的 `host-*` 子目录提取指定核心包及依赖，结束时清理该子目录，不复用历史模块缓存。检查拒绝归档路径逃逸和链接项；每次 Desktop 升级可对新安装包运行此检查，不需先改版本号。若提示词、来源结构或模型分派行为有变化，结合失败项核对新模板，再更新相关规则或验证器。不要为了通过检查而对整份提示词做产品名替换。

运行上下文检查同时覆盖旧渲染器和实际 AgentLoop 的首次、替换、清空及转义行为，不能只调用 system-prompt 的展示辅助函数。测试从可信归档按明确边界读出原厂 RuntimeContextProjection，在无 I/O 的测试 VM 中执行其 project 方法；跳过构造函数，不启动 AgentLoop。另在真实 assemble waterfall 上注入合成的新身份句，验证被动学习、模型隔离及重复输入稳定。

该集成使用提供的核心服务和内存适配器，阻断进程内网络入口；不启动 Desktop、读取真实配置、修改插件安装、重启宿主或调用真实模型。报告列出实际包版本、稳定投影、并发隔离、开关更新和卸载恢复等离线结果。它不等同于实际宿主或供应商验收，CI 不要求持有 Desktop 安装包。

## 准备安装包

在通过验证的标签上运行 `npm pack --ignore-scripts`。从归档安装时不需要编译，DSH 会安装插件的运行依赖。

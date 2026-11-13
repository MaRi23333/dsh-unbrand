# 发布候选验证

当前候选为 `dsh-unbrand@0.1.4`，适配 DSH Desktop `0.2.2-rc.1`。本项目无需编译，运行文件直接进入包。

CI 运行测试和打包检查，不会自动发布。Release 附件与 npm 使用同一份通过检查的 .tgz。

## 独立 checkout

在仓库根目录使用 Node.js `>=22.19.0` 和 npm：

```sh
npm ci --ignore-scripts
npm test
npm run check:pack
```

CI 在 Linux、Windows 和 Node.js `22.19.0`、`24` 运行同一组检查，只申请 `contents: read`，不保留 checkout 凭据，不需要秘密或发布令牌。锁文件为依赖来源；安装不执行依赖生命周期脚本。无需父工作区、DSH 安装目录、用户 profile、真实模型或收费请求。

`check:pack` 实际执行 `npm pack --ignore-scripts`，先核对 npm 报告，再从生成的 gzip/tar 中核对每个成员并解包。tarball 必须恰好包含下列 18 个文件：

```text
CHANGELOG.md
CONTRIBUTING.md
LICENSE
README.en.md
README.md
SECURITY.md
THIRD_PARTY_NOTICES.md
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

输出目录只保留本次成功运行的 `REPORT.json`；同名旧报告会在检查开始时移除，失败不会留下旧的成功结论。每次使用全新的 `host-*` 子目录提取指定核心包及依赖，结束时清理该子目录，不复用历史模块缓存。检查拒绝归档路径逃逸和链接项；若宿主归档结构或 `0.2.2-rc.1` 内部边界发生变化，应先重新审查脚本契约。

该集成使用提供的核心服务和内存适配器，阻断进程内网络入口；不启动 Desktop、读取真实配置、修改插件安装、重启宿主或调用真实模型。报告列出实际包版本、稳定投影、并发隔离、开关更新和卸载恢复等离线结果。它不等同于实际宿主或供应商验收，CI 不要求持有 Desktop 安装包。

## 准备安装包

在通过验证的标签上运行 `npm pack --ignore-scripts`。从归档安装时不需要编译，DSH 会安装插件的运行依赖。

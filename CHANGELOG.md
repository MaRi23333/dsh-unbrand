# 版本记录 · Changelog

## 0.1.4 — 首次公开发布 / First public release

选定模型的沙箱说明保留原有权限与路径，仅去掉产品名。指令开头的全局 `AGENTS.md` 来源显示为用户全局规则；指令正文、项目路径、工具和技能保持原样。

For selected models, removes the product name from the sandbox notice without changing permissions or paths. Labels the leading global `AGENTS.md` heading as user-global. Leaves instruction text, project paths, tools, and skills intact.

## 0.1.3 — 本地候选 / Local candidate

尚未发布。模型目录和已选列表同时显示模型名称与供应商；手动输入收在单独入口。补充中英文首页、设置页示例图、贡献说明和问题模板，以及从真实安装包加载插件的离线检查。请求改写规则未变。

Unpublished. The model picker and selected list show both model and provider. Manual ID entry has its own control. Adds bilingual documentation and screenshots, contribution and issue templates, and an offline check that loads the plugin from its actual package. Request rewriting is unchanged.

## 0.1.2 — 本地基线 / Local baseline

- 包名、源码目录与客户端模块名统一为 `dsh-unbrand`；宿主插件与设置 ID 为 `unbrand`。
- 为选定模型改写宿主固定身份说明与指定运行上下文定位行；不回写历史。
- 设置页支持模型目录搜索、供应商限定选择、手动规则与保存后生效；默认列表为空。
- 兼容范围限定为 DSH Desktop `0.2.2-rc.1`。

- Aligns the package, source directory, and client module name as `dsh-unbrand`; the host plugin and settings ID is `unbrand`.
- Rewrites fixed host identity text and designated runtime-location lines for selected models without rewriting history.
- Provides catalog search, provider-scoped selection, manual rules, and saved settings that apply to subsequent requests. The default list is empty.
- Restricts compatibility to DSH Desktop `0.2.2-rc.1`.

版本条目不代表已在 npm 或 GitHub 发布。 / Version entries do not imply an npm or GitHub release.

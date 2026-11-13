# 隐标 · Unbrand

**中文** · [English](./README.en.md)

**隐标可以把 DeepSeek Harness（DSH）发给模型的自我介绍换成一句普通的提示。你来选对哪些模型生效。**

| 默认提示 | 开启隐标后 |
| --- | --- |
| `You are an AI agent powered by DeepSeek Harness.` | `You are an AI assistant.` |

对选中的模型，隐标也会去掉 DSH 自动附上的源码位置和网页界面地址。你自己在对话里提到 DSH，模型仍会看到。聊天记录、工具和文件权限都不变。

## 怎么用

1. 在 **DSH Desktop 0.2.2-rc.1** 打开「插件 → 添加插件」，输入 `dsh-unbrand@0.1.4` 并启用。若提示重启，退出后重新打开 DSH。
2. 在「设置 → 隐标」勾选模型，点「保存」。默认没有选中任何模型。
3. 从下一次请求起生效，不用新开会话。想恢复默认提示，关掉隐标并保存即可。

![隐标设置页：搜索并勾选模型](./assets/settings-zh.png)

*图中的模型目录为示例。*

目前只支持上述桌面版本。[下载安装包](https://github.com/MaRi23333/dsh-unbrand/releases/tag/v0.1.4) · [其他安装方式和详细说明](https://github.com/MaRi23333/dsh-unbrand/blob/main/docs/usage.zh-CN.md) · [MIT 许可证](./LICENSE)

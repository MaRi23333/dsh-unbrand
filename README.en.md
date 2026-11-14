# Unbrand · 隐标

[中文](./README.md) · **English**

**Unbrand helps you use third-party models with DeepSeek Harness (DSH).** Select a model to give it a neutral opening prompt in place of the default DSH introduction:

| Default DSH prompt | What the selected model receives |
| --- | --- |
| `You are an AI agent powered by DeepSeek Harness.` | `You are an AI assistant.` |

For those models, Unbrand also removes the source location and web interface address that DSH adds automatically. If you mention DSH in a conversation, the model still sees it. Your chat history, tools, and file permissions stay the same.

## Download and install

**From 0.1.5 onward**, Unbrand requires DSH Desktop `0.2.2-rc.1` or later, with no upper version limit. After a Desktop update, recognized prompts are still processed and unknown wording passes through unchanged.

Version 0.1.4 still requires rc.1. The steps below install 0.1.5. If that version is not yet available on npm, use the GitHub Release archive linked below.

1. In the sidebar, open **Plugins → Add plugin** and enter `dsh-unbrand@0.1.5` or the full path to the archive linked below.
2. Select **Enable now** after installation. If a restart is requested, choose **Quit** from the application menu and reopen DSH.
3. Look for **Settings → Unbrand** to confirm it is enabled.

**Prefer a download?** [Download dsh-unbrand-0.1.5.tgz](https://github.com/MaRi23333/dsh-unbrand/releases/download/v0.1.5/dsh-unbrand-0.1.5.tgz). Leave it packed and enter its full path in the same **Add plugin** box, then enable it as above. [View on npm](https://www.npmjs.com/package/dsh-unbrand)

<details>
<summary>Install with the desktop CLI</summary>

Start DSH Desktop once, select **Manage dsh Command… → Install** from the application menu, then quit the app. In a new terminal, run:

```sh
dsh plugin --profile desktop add dsh-unbrand@0.1.5
dsh plugin --profile desktop list
```

Once you see `dsh-unbrand@0.1.5`, reopen Desktop and enable the plugin. Use the `dsh` command bundled with Desktop; a standalone CLI installed with npm or run with `npx` cannot manage desktop plugins.

</details>

## Getting started

1. Open **Settings → Unbrand**, select the models that should receive the neutral prompt, and click **Save**. All other models keep the default prompt.
2. The next request uses the new wording, even in an existing chat. To restore the default prompt, turn Unbrand off and save.

![Unbrand settings showing how to search for and select a model](./assets/settings-en.png)

*The model catalog shown here is an example.*

[Other ways to install and full usage guide](https://github.com/MaRi23333/dsh-unbrand/blob/main/docs/usage.en.md) · [MIT license](./LICENSE)

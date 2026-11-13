# Unbrand usage guide

## Compatibility and installation

**Unbrand 0.1.4 supports DSH Desktop 0.2.2-rc.1 only.** It uses an internal interface from this version. Other Desktop releases and standalone Web deployments are not supported.

1. In DSH Desktop, open **Plugins → Add plugin** and enter `dsh-unbrand@0.1.4`. Alternatively, download `dsh-unbrand-0.1.4.tgz` from the [GitHub release](https://github.com/MaRi23333/dsh-unbrand/releases/tag/v0.1.4) and enter its full path without extracting it.
2. Enable the plugin. If prompted to restart, quit DSH from its application menu and reopen it.
3. Open **Settings → Unbrand**, select a model, and save. The change applies to the next request.

To run from source, use Node.js 22.19.0 or later. Run `npm ci --ignore-scripts` in the source directory, then run `dsh plugin --profile desktop add .` with the CLI bundled with Desktop. Keep the directory in place.

## Usage

The model list is empty by default. **Enabling the plugin alone does not change any request.**

In **Settings → Unbrand**, search by model name, ID, or provider, select the models to filter, then click **Save**. Catalog selections match that specific provider route, so identically named models can be selected separately. Saved changes apply to the next model request; a new conversation is not required.

For a model missing from the catalog, open **Model missing? Add it manually** and enter the actual request ID:

| Example rule | Matches |
| --- | --- |
| `vendor/model-a` | Model ID exactly `vendor/model-a`, on any provider |
| `gateway::vendor/model-a` | Provider ID `gateway` and model ID `vendor/model-a` |

Rules are case-sensitive, exact matches with no wildcards. Saved rules remain available when a model disappears from the catalog. Disable filtering or remove all rules and save to leave subsequent requests unchanged.

## Before you start

- Replaces fixed identity text and designated runtime-location lines. The sandbox notice loses only the product name; permission modes, writable paths and approval instructions are preserved. A leading source heading for the user's global `AGENTS.md` is labeled as user-global; instruction text and project headings stay intact. Unrecognized sources or layouts are left unchanged.
- Changes the copy passed to the model adapter, without rewriting stored history. There is no global replacement across user or assistant messages, tool definitions or results, skills, or other plugins' own `system` fields or messages. Plugins that call a model service directly bypass this entry point.
- Does not change request headers, provider routing, permissions, reasoning settings, or cache identifiers. Equal effective input produces stable rewritten content. Enabling or changing rules changes affected request content; provider cache hits are not guaranteed.
- Unbrand only changes the host text described above. Conversations, tool results, and other plugins may still mention DSH, so a model may still recognize the application.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for feedback and development, and [CHANGELOG.md](../CHANGELOG.md) for version notes.

[MIT License](../LICENSE). This is an independent community project, with no affiliation with or endorsement by DeepSeek.

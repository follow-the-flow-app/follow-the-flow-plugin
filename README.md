# Follow The Flow plugin

Work with [Follow The Flow](https://follow-the-flow.app) from your AI agent. Everything the agent does is authenticated with OAuth 2.1 and authorized by Follow The Flow with your existing permissions; the plugin keeps no permissions of its own.

This repository is the plugin and its marketplace, part of Follow The Flow's Agent Integration work. Today the plugin connects your agent to the Follow The Flow MCP server, whose tools are listed below, and adds one skill; the server itself is not here.

> The endpoint is the development environment, `https://mcp-dev.follow-the-flow.app/v1/mcp`, until production opens. You need an invitation to an organization to sign in. Until the workflow backend is connected there, the development environment answers mock data (`"mock": true`).

## Install

| Client                           | How                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code                      | `claude plugin marketplace add follow-the-flow-app/follow-the-flow-plugin`, then `/plugin install follow-the-flow@follow-the-flow`. Turn on auto-update for this marketplace in `/plugin` → Marketplaces     |
| Claude Desktop                   | Settings → Plugins → add the marketplace `follow-the-flow-app/follow-the-flow-plugin`, install **Follow The Flow**, then connect it on the plugin's Connectors tab                                           |
| Codex CLI                        | `codex plugin marketplace add https://github.com/follow-the-flow-app/follow-the-flow-plugin`, then install **follow-the-flow**                                                                               |
| Codex in the ChatGPT desktop app | **Plugins** → add the marketplace above → install **follow-the-flow**                                                                                                                                        |
| ChatGPT (Chat, Work)             | chatgpt.com/plugins → **Add custom MCP server** → `https://mcp-dev.follow-the-flow.app/v1/mcp`                                                                                                               |
| Any other MCP client             | Use the server URL `https://mcp-dev.follow-the-flow.app/v1/mcp`                                                                                                                                              |

## Tools

| Tool                   | What it answers                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getUserInfo`          | Your organization and the user this agent acts for                                                                                                                                                    |
| `listWorkflowProducts` | The workflow products you can use now, each with an `id` (a UUID) and a `code` such as `wp03`; the other tools take the `code`. For discovery only: every operation is still authorized by the server |
| `getWorkflowProduct`   | What one workflow product does and what it needs to run, by its `code`                                                                                                                                |
| `prepareWorkflowRun`   | Prepares a run from the given input: a `prepareId`, a preview, whether a person must confirm it, and when it expires                                                                                  |
| `startWorkflowRun`     | Starts the run a prepare prepared. The same `prepareId` always answers the same run                                                                                                                   |
| `getWorkflowRun`       | The state and result of one run                                                                                                                                                                       |
| `cancelWorkflowRun`    | Cancels a run before anything is sent outside the firm or any money moves; a run already cancelled answers the same again                                                                             |
| `listApprovalRequests` | Your firm's approval requests (WP-04 bill drafts, and WP-05 payment differences, that an owner or an admin approves or returns), optionally only those with one status, such as pending                                                       |
| `decideApprovalRequest` | Approves or returns one approval request. The same `commandId` (a UUID the agent makes on its first send) always answers the same decision                                                          |
| `listBankStatements`   | The bank statements a person uploaded on the web app, for WP-05. There is no tool to upload one                                                                                                      |

`getUserInfo`, `listWorkflowProducts`, `getWorkflowProduct`, `getWorkflowRun`, `listApprovalRequests` and `listBankStatements` only read. `prepareWorkflowRun`, `startWorkflowRun`, `cancelWorkflowRun` and `decideApprovalRequest` do not.

## Skills

| Skill                   | What it does                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run-workflow-products` | Prepares a run, shows you the preview and waits for your yes before starting any workflow product that requires confirmation (issuing and sending bills, writing off receivables), and prepares again when a preview goes stale. Shows you each WP-04 bill and each WP-05 payment difference waiting for approval and approves or returns only the ones you say yes to; for WP-05 it finds a statement you uploaded and shows you its matches and differences before it starts |

Asking you first is the plugin's behaviour, not a security check: the server authorizes every start again and refuses a preview that has expired or whose data changed, whether or not the agent asked.

## Packaging

| Format                                                 | Manifest                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [Agent Plugins v1](https://agent-plugins.org/) (Codex) | `plugin.json`, `mcp.json`                                                           |
| Claude Code plugin and marketplace                     | `.claude-plugin/plugin.json` (MCP server inline), `.claude-plugin/marketplace.json` |
| Agent Skills, read by both formats                     | `skills/<name>/SKILL.md`; no manifest names the folder, both formats read `skills/` |
| MCP registry                                           | `server.json`                                                                       |

`npm test` and `npm run validate` check every manifest. `npm run check:endpoint` runs `validate`, then checks that the endpoint the manifests agree on is the resource the live server names in its public RFC 9728 metadata (no token needed). It shows the manifests agree with the server they point at, not that they point at the right environment. CI runs all three on every push and pull request, and daily, because the server can change without this repository changing. GitHub turns the daily run off after 60 days without activity in this repository; turn it back on under **Actions** → **validate**.

Clients install the default branch, `main`. Changes land on `dev` first; merging `dev` into `main` publishes them.

## License

Apache-2.0

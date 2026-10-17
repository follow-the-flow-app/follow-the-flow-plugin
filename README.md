# Follow The Flow MCP Server

Connect AI agents to [Follow The Flow](https://follow-the-flow.app). Once connected, an agent can see who you are, which workflow products you can use, and start and follow their runs. Every call is authenticated with OAuth 2.1 and authorized by the server with your existing permissions; the plugin keeps no permissions of its own.

This repository is the plugin and its marketplace. The server itself is not here.

> The endpoint is the development environment, `https://mcp-dev.follow-the-flow.app/v1/mcp`, until production opens. You need an invitation to an organization to sign in. The tools answer mock data for now (`"mock": true`).

## Install

| Client                           | How                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code                      | `claude plugin marketplace add follow-the-flow-app/follow-the-flow-mcp-server`, then `/plugin install follow-the-flow@follow-the-flow`. Turn on auto-update for this marketplace in `/plugin` → Marketplaces |
| Claude Desktop                   | Settings → Plugins → add the marketplace `follow-the-flow-app/follow-the-flow-mcp-server`, install **Follow The Flow MCP**, then connect it on the plugin's Connectors tab                                   |
| Codex CLI                        | `codex plugin marketplace add https://github.com/follow-the-flow-app/follow-the-flow-mcp-server`, then install **follow-the-flow**                                                                           |
| Codex in the ChatGPT desktop app | **Plugins** → add the marketplace above → install **follow-the-flow**                                                                                                                                        |
| ChatGPT (Chat, Work)             | chatgpt.com/plugins → **Add custom MCP server** → `https://mcp-dev.follow-the-flow.app/v1/mcp`                                                                                                               |
| Any other MCP client             | Use the server URL `https://mcp-dev.follow-the-flow.app/v1/mcp`                                                                                                                                              |

## Tools

| Tool                   | What it answers                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `getUserInfo`          | Your organization and the user this agent acts for                                                           |
| `listWorkflowProducts` | The workflow products you can use now. For discovery only: every operation is still authorized by the server |
| `getWorkflowProduct`   | What one workflow product does and what it needs to run                                                      |
| `startWorkflowRun`     | Starts a run of a workflow product with the given input                                                      |
| `getWorkflowRun`       | The state and result of one run                                                                              |

All tools except `startWorkflowRun` only read.

## Packaging

| Format                                                 | Manifest                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [Agent Plugins v1](https://agent-plugins.org/) (Codex) | `plugin.json`, `mcp.json`                                                    |
| Claude Code plugin and marketplace                     | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json` |
| MCP registry                                           | `server.json`                                                                |

`npm test` and `npm run validate` check every manifest. `npm run check:endpoint` checks that the manifests name the live server's MCP endpoint, read from its public RFC 9728 metadata (no token needed). CI runs all three, and runs them daily as well, because the server can change without this repository changing.

## License

Apache-2.0

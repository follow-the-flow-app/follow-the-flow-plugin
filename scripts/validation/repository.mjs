import { access, readFile } from "node:fs/promises";
import path from "node:path";

const REQUIRED = [
  "plugin.json",
  "mcp.json",
  ".mcp.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "server.json",
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "CODEOWNERS",
];
const SEMVER = /^\d+\.\d+\.\d+$/;
const ENDPOINT = /^https:\/\/[^/]+\/v\d+\/mcp$/;
/** I spec I-6: the MCP registry identity. */
const REGISTRY_NAME = "app.follow-the-flow/follow-the-flow-mcp-server";

/** The checks of I spec I-6: every client's file, one plugin version, one MCP endpoint. */
export async function validateRepository(root) {
  const errors = [];
  const warnings = [];
  const json = {};
  for (const file of REQUIRED) {
    try {
      await access(path.join(root, file));
    } catch {
      errors.push(`missing ${file}`);
      continue;
    }
    if (!file.endsWith(".json")) continue;
    try {
      json[file] = JSON.parse(await readFile(path.join(root, file), "utf8"));
    } catch {
      errors.push(`${file} is not valid JSON`);
    }
  }
  if (errors.length > 0) return { errors, warnings };

  const plugin = json["plugin.json"];
  const claude = json[".claude-plugin/plugin.json"];
  const market = json[".claude-plugin/marketplace.json"];
  const server = json["server.json"];
  const name = plugin.name;

  for (const field of ["name", "version", "description", "license"]) {
    if (typeof plugin[field] !== "string" || plugin[field] === "")
      errors.push(`plugin.json needs ${field}`);
  }
  if (!SEMVER.test(plugin.version ?? ""))
    errors.push(`plugin.json version ${plugin.version} is not x.y.z`);
  if (plugin.license !== "Apache-2.0") errors.push("plugin.json license must be Apache-2.0");

  if (claude.name !== name) errors.push(".claude-plugin/plugin.json name differs from plugin.json");
  if ("version" in claude)
    errors.push(
      ".claude-plugin/plugin.json must not set version: the marketplace entry carries it",
    );
  if (claude.mcpServers !== "./.mcp.json")
    errors.push('.claude-plugin/plugin.json mcpServers must be "./.mcp.json"');

  const entry = (market.plugins ?? []).find((p) => p.name === name);
  if (!entry) errors.push(`.claude-plugin/marketplace.json lists no plugin named ${name}`);
  else {
    if (entry.version !== plugin.version) {
      errors.push(
        `plugin version differs: plugin.json ${plugin.version}, marketplace entry ${entry.version}`,
      );
    }
    if (entry.source !== "./")
      errors.push('.claude-plugin/marketplace.json entry source must be "./"');
  }
  if (!market.owner?.email)
    warnings.push(".claude-plugin/marketplace.json owner has no email yet (I spec §9.2)");

  if (server.name !== REGISTRY_NAME)
    errors.push(`server.json name ${server.name} must be ${REGISTRY_NAME}`);
  if (!SEMVER.test(server.version ?? ""))
    errors.push(`server.json version ${server.version} is not x.y.z`);

  const portable = json["mcp.json"].mcpServers?.[name];
  const claudeMcp = json[".mcp.json"].mcpServers?.[name];
  const remote = server.remotes?.[0];
  if (portable?.type !== "streamable-http")
    errors.push('mcp.json transport must be "streamable-http"');
  if (claudeMcp?.type !== "http") errors.push('.mcp.json transport must be "http"');
  if (remote?.type !== "streamable-http")
    errors.push('server.json remote transport must be "streamable-http"');

  const urls = {
    "mcp.json": portable?.url,
    ".mcp.json": claudeMcp?.url,
    "server.json": remote?.url,
  };
  if (new Set(Object.values(urls)).size !== 1)
    errors.push(`MCP endpoint differs: ${JSON.stringify(urls)}`);
  for (const [file, url] of Object.entries(urls)) {
    if (!ENDPOINT.test(url ?? ""))
      errors.push(`${file} MCP endpoint ${url} must be https and end in /v<n>/mcp`);
  }
  return { errors, warnings };
}

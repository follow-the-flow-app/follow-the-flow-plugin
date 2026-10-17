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
const ENDPOINT_PATH = /^\/v\d+\/mcp$/;
/** I spec I-6: the MCP registry identity. */
const REGISTRY_NAME = "app.follow-the-flow/follow-the-flow-mcp-server";
/** I spec I-6: the plugin and the marketplace are both "follow-the-flow"; the README installs follow-the-flow@follow-the-flow. */
const PLUGIN_NAME = "follow-the-flow";

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isSemver = (value) => typeof value === "string" && SEMVER.test(value);

/** https://<host>/v<n>/mcp, parsed rather than pattern-matched, written the way URL writes it back. */
function isEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    ENDPOINT_PATH.test(url.pathname) &&
    // Not url.href: it keeps an empty "?" or "#", which search and hash report as "".
    `${url.origin}${url.pathname}` === value
  );
}

/** The checks of I spec I-6: every client's file, one plugin version, one MCP endpoint. */
export async function validateRepository(root) {
  const errors = [];
  const warnings = [];
  const json = {};
  for (const file of REQUIRED) {
    try {
      await access(path.join(root, file));
    } catch (error) {
      errors.push(error.code === "ENOENT" ? `missing ${file}` : `cannot read ${file}: ${error.message}`);
      continue;
    }
    if (!file.endsWith(".json")) continue;
    let text;
    try {
      text = await readFile(path.join(root, file), "utf8");
    } catch (error) {
      errors.push(`cannot read ${file}: ${error.message}`);
      continue;
    }
    try {
      json[file] = JSON.parse(text);
    } catch (error) {
      errors.push(`${file} is not valid JSON: ${error.message}`);
      continue;
    }
    if (!isObject(json[file])) errors.push(`${file} must be a JSON object`);
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
  if (name !== PLUGIN_NAME) errors.push(`plugin.json name ${name} must be ${PLUGIN_NAME}`);
  if (market.name !== PLUGIN_NAME)
    errors.push(`.claude-plugin/marketplace.json name ${market.name} must be ${PLUGIN_NAME}`);
  if (!isSemver(plugin.version))
    errors.push(`plugin.json version ${JSON.stringify(plugin.version)} is not x.y.z`);
  if (plugin.license !== "Apache-2.0") errors.push("plugin.json license must be Apache-2.0");

  if (claude.name !== name) errors.push(".claude-plugin/plugin.json name differs from plugin.json");
  if ("version" in claude)
    errors.push(
      ".claude-plugin/plugin.json must not set version: the marketplace entry carries it",
    );
  if (claude.mcpServers !== "./.mcp.json")
    errors.push('.claude-plugin/plugin.json mcpServers must be "./.mcp.json"');

  const plugins = market.plugins ?? [];
  if (!Array.isArray(plugins))
    errors.push(".claude-plugin/marketplace.json plugins must be an array");
  // I spec I-6: one plugin entry.
  else if (plugins.length > 1)
    errors.push(`.claude-plugin/marketplace.json must list exactly one plugin, found ${plugins.length}`);
  const entries = Array.isArray(plugins) ? plugins.filter((p) => p?.name === name) : [];
  if (entries.length === 0) errors.push(`.claude-plugin/marketplace.json lists no plugin named ${name}`);
  else if (entries.length > 1)
    errors.push(`.claude-plugin/marketplace.json lists ${entries.length} plugins named ${name}`);
  else {
    const [entry] = entries;
    if (entry.version !== plugin.version) {
      errors.push(
        `plugin version differs: plugin.json ${JSON.stringify(plugin.version)}, marketplace entry ${JSON.stringify(entry.version)}`,
      );
    }
    if (entry.source !== "./")
      errors.push('.claude-plugin/marketplace.json entry source must be "./"');
  }
  if (!market.owner?.email)
    warnings.push(".claude-plugin/marketplace.json owner has no email yet (I spec §9.2)");

  if (server.name !== REGISTRY_NAME)
    errors.push(`server.json name ${server.name} must be ${REGISTRY_NAME}`);
  if (!isSemver(server.version))
    errors.push(`server.json version ${JSON.stringify(server.version)} is not x.y.z`);

  // I spec I-6: the plugin holds one URL, so each manifest names exactly one server.
  for (const file of ["mcp.json", ".mcp.json"]) {
    const keys = Object.keys(json[file].mcpServers ?? {});
    if (keys.length !== 1 || keys[0] !== name)
      errors.push(`${file} must list only ${name} under mcpServers, found ${JSON.stringify(keys)}`);
  }
  if (!Array.isArray(server.remotes) || server.remotes.length !== 1)
    errors.push("server.json must have exactly one remote");

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
    if (!isEndpoint(url))
      errors.push(`${file} MCP endpoint ${url} must be https://<host>/v<n>/mcp`);
  }
  return { errors, warnings };
}

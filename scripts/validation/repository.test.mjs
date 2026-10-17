import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { validateRepository } from "./repository.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

/** A copy of this repo's manifests, changed by `edit`, in a fresh temporary directory. */
async function fixture(edit) {
  const dir = await mkdtemp(path.join(tmpdir(), "ftf-plugin-"));
  for (const file of [
    "plugin.json",
    "mcp.json",
    ".mcp.json",
    ".claude-plugin",
    "server.json",
    "README.md",
    "LICENSE",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "CODEOWNERS",
  ]) {
    await cp(path.join(repoRoot, file), path.join(dir, file), { recursive: true });
  }
  await edit(dir);
  return dir;
}

async function rewrite(dir, file, change) {
  const json = JSON.parse(await readFile(path.join(dir, file), "utf8"));
  change(json);
  await writeFile(path.join(dir, file), JSON.stringify(json, null, 2));
}

async function errorsOf(edit) {
  const dir = await fixture(edit);
  try {
    return (await validateRepository(dir)).errors;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("this repository is valid", async () => {
  assert.deepEqual((await validateRepository(repoRoot)).errors, []);
});

test("a missing file is an error", async () => {
  const errors = await errorsOf((dir) => rm(path.join(dir, "server.json")));
  assert.ok(
    errors.some((e) => e.includes("server.json")),
    errors.join("\n"),
  );
});

test("the plugin version must be the same in plugin.json and the marketplace entry", async () => {
  const errors = await errorsOf((dir) =>
    rewrite(dir, "plugin.json", (j) => {
      j.version = "1.0.1";
    }),
  );
  assert.ok(
    errors.some((e) => e.includes("version")),
    errors.join("\n"),
  );
});

test(".claude-plugin/plugin.json must not set a version (I spec I-6)", async () => {
  const errors = await errorsOf((dir) =>
    rewrite(dir, ".claude-plugin/plugin.json", (j) => {
      j.version = "1.0.0";
    }),
  );
  assert.ok(
    errors.some((e) => e.includes(".claude-plugin/plugin.json")),
    errors.join("\n"),
  );
});

test("the MCP endpoint must be the same in mcp.json, .mcp.json and server.json", async () => {
  const errors = await errorsOf((dir) =>
    rewrite(dir, ".mcp.json", (j) => {
      j.mcpServers["follow-the-flow"].url = "https://mcp.follow-the-flow.app/v1/mcp";
    }),
  );
  assert.ok(
    errors.some((e) => e.includes("endpoint")),
    errors.join("\n"),
  );
});

test("the MCP endpoint must be https and end in /v<n>/mcp", async () => {
  const errors = await errorsOf(async (dir) => {
    const url = "http://mcp-dev.follow-the-flow.app/mcp";
    await rewrite(dir, "mcp.json", (j) => {
      j.mcpServers["follow-the-flow"].url = url;
    });
    await rewrite(dir, ".mcp.json", (j) => {
      j.mcpServers["follow-the-flow"].url = url;
    });
    await rewrite(dir, "server.json", (j) => {
      j.remotes[0].url = url;
    });
  });
  assert.ok(
    errors.some((e) => e.includes("https")),
    errors.join("\n"),
  );
});

test("each client's file must use its own transport name", async () => {
  const errors = await errorsOf((dir) =>
    rewrite(dir, ".mcp.json", (j) => {
      j.mcpServers["follow-the-flow"].type = "streamable-http";
    }),
  );
  assert.ok(
    errors.some((e) => e.includes(".mcp.json")),
    errors.join("\n"),
  );
});

/** Each manifest field the validator guards, broken one at a time, and a word its error must name. */
const BROKEN = [
  [".claude-plugin/plugin.json", (j) => (j.name = "other"), "name"],
  [".claude-plugin/plugin.json", (j) => (j.mcpServers = "./mcp.json"), "mcpServers"],
  [".claude-plugin/marketplace.json", (j) => (j.plugins[0].source = "./plugin"), "source"],
  ["mcp.json", (j) => (j.mcpServers["follow-the-flow"].type = "http"), "mcp.json transport"],
  ["server.json", (j) => (j.remotes[0].type = "sse"), "server.json remote transport"],
  ["plugin.json", (j) => (j.license = "MIT"), "license"],
  ["plugin.json", (j) => (j.version = "1.0"), "not x.y.z"],
  ["server.json", (j) => (j.version = "v1"), "not x.y.z"],
  // I spec I-6: the registry identity; only the name changes, so nothing else can catch it.
  [
    "server.json",
    (j) => (j.name = "app.follow-the-flow/other-server"),
    "server.json name app.follow-the-flow/other-server",
  ],
  ["server.json", (j) => delete j.name, "server.json name undefined"],
];

for (const [file, change, word] of BROKEN) {
  test(`${file}: ${change.toString()} is an error naming "${word}"`, async () => {
    const errors = await errorsOf((dir) => rewrite(dir, file, change));
    assert.ok(
      errors.some((e) => e.includes(word)),
      errors.join("\n"),
    );
  });
}

test("a manifest that is not JSON is an error", async () => {
  const errors = await errorsOf((dir) => writeFile(path.join(dir, "server.json"), "{"));
  assert.ok(
    errors.some((e) => e.includes("server.json is not valid JSON")),
    errors.join("\n"),
  );
});

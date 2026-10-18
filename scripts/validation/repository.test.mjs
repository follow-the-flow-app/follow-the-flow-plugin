import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

test("the MCP endpoint must be the same in mcp.json, the inline mcpServers and server.json", async () => {
  const errors = await errorsOf((dir) =>
    rewrite(dir, ".claude-plugin/plugin.json", (j) => {
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
    await rewrite(dir, ".claude-plugin/plugin.json", (j) => {
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

/** Each manifest field the validator guards, broken one at a time, and a word its error must name. */
const BROKEN = [
  [".claude-plugin/plugin.json", (j) => (j.name = "other"), "name"],
  // I spec I-6 (10-18 inline addendum): the old path form is no longer accepted.
  [".claude-plugin/plugin.json", (j) => (j.mcpServers = "./.mcp.json"), "mcpServers must be an inline map"],
  [".claude-plugin/plugin.json", (j) => delete j.mcpServers, ".claude-plugin/plugin.json needs mcpServers"],
  [".claude-plugin/marketplace.json", (j) => (j.plugins[0].source = "./plugin"), "source"],
  ["mcp.json", (j) => (j.mcpServers["follow-the-flow"].type = "http"), "mcp.json transport"],
  [
    ".claude-plugin/plugin.json",
    (j) => (j.mcpServers["follow-the-flow"].type = "streamable-http"),
    '.claude-plugin/plugin.json transport must be "http"',
  ],
  [
    ".claude-plugin/plugin.json",
    (j) => delete j.mcpServers["follow-the-flow"].type,
    '.claude-plugin/plugin.json transport must be "http"',
  ],
  // A missing URL is named in the "differs" message, not dropped from it.
  [
    ".claude-plugin/plugin.json",
    (j) => delete j.mcpServers["follow-the-flow"].url,
    '".claude-plugin/plugin.json":null',
  ],
  // I spec I-6: a server entry is type and url. Anything else (a header with a token) would ship to every user.
  [
    ".claude-plugin/plugin.json",
    (j) => (j.mcpServers["follow-the-flow"].headers = { Authorization: "Bearer x" }),
    ".claude-plugin/plugin.json server follow-the-flow may only set type and url, found headers",
  ],
  [
    "mcp.json",
    (j) => (j.mcpServers["follow-the-flow"].headers = { Authorization: "Bearer x" }),
    "mcp.json server follow-the-flow may only set type and url, found headers",
  ],
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
  // The README's install command is follow-the-flow@follow-the-flow: both names are part of it.
  ["plugin.json", (j) => (j.name = "other"), "plugin.json name other"],
  [".claude-plugin/marketplace.json", (j) => (j.name = "other"), "marketplace.json name other"],
  // I spec I-6: the plugin holds one URL, so a second server or remote is an error.
  [
    ".claude-plugin/plugin.json",
    (j) => (j.mcpServers.other = { type: "http", url: "http://evil.example/x" }),
    ".claude-plugin/plugin.json must list only follow-the-flow",
  ],
  [
    "mcp.json",
    (j) => (j.mcpServers.other = { type: "streamable-http", url: "http://evil.example/x" }),
    "mcp.json must list only follow-the-flow",
  ],
  [
    "server.json",
    (j) => j.remotes.push({ type: "streamable-http", url: "http://evil.example/mcp" }),
    "server.json must have exactly one remote",
  ],
  [
    ".claude-plugin/marketplace.json",
    (j) => j.plugins.push({ ...j.plugins[0], version: "9.9.9", source: "./other" }),
    "lists 2 plugins named follow-the-flow",
  ],
  ["server.json", (j) => (j.version = ["1.0.0"]), "not x.y.z"],
  [".claude-plugin/marketplace.json", (j) => (j.plugins = {}), "plugins must be an array"],
  ["plugin.json", (j) => (j.version = "1.0.0-beta"), "not x.y.z"],
  ["plugin.json", (j) => (j.version = "v1.0.0"), "not x.y.z"],
  ["plugin.json", (j) => (j.description = ""), /^plugin\.json description must be a non-empty string$/],
  // I spec I-6: the marketplace has one plugin entry.
  [
    ".claude-plugin/marketplace.json",
    (j) => j.plugins.push({ name: "other", source: "./other", version: "1.0.0" }),
    "must list exactly one plugin",
  ],
  // The only entry or server renamed: the count guards still see one.
  [
    ".claude-plugin/marketplace.json",
    (j) => (j.plugins[0].name = "other"),
    "lists no plugin named follow-the-flow",
  ],
  [
    "mcp.json",
    (j) => (j.mcpServers = { other: j.mcpServers["follow-the-flow"] }),
    "mcp.json must list only follow-the-flow",
  ],
  [
    ".claude-plugin/plugin.json",
    (j) => (j.mcpServers = { other: j.mcpServers["follow-the-flow"] }),
    ".claude-plugin/plugin.json must list only follow-the-flow",
  ],
  // I spec I-6's field table. Claude Code rejects a marketplace without owner.name. The root
  // plugin.json rows are anchored: ".claude-plugin/plugin.json needs author" contains "plugin.json needs author".
  ["plugin.json", (j) => delete j.author, /^plugin\.json needs author$/],
  ["plugin.json", (j) => (j.author = { url: "https://follow-the-flow.app" }), /^plugin\.json author must be an object/],
  ["plugin.json", (j) => (j.author = "Follow The Flow"), /^plugin\.json author must be an object/],
  ["plugin.json", (j) => delete j.homepage, /^plugin\.json needs homepage$/],
  ["plugin.json", (j) => delete j.repository, /^plugin\.json needs repository$/],
  [
    "plugin.json",
    (j) => (j.repository = { type: "git", url: "https://github.com/follow-the-flow-app/follow-the-flow-plugin" }),
    /^plugin\.json repository must be a non-empty string$/,
  ],
  ["plugin.json", (j) => (j.keywords = []), /^plugin\.json keywords must be a non-empty array/],
  ["plugin.json", (j) => (j.keywords = [""]), /^plugin\.json keywords must be a non-empty array/],
  ["plugin.json", (j) => (j.keywords = "mcp"), /^plugin\.json keywords must be a non-empty array/],
  [".claude-plugin/plugin.json", (j) => delete j.displayName, ".claude-plugin/plugin.json needs displayName"],
  [".claude-plugin/plugin.json", (j) => (j.displayName = "Follow the Flow"), '.claude-plugin/plugin.json displayName must be "Follow The Flow"'],
  [".claude-plugin/plugin.json", (j) => delete j.description, ".claude-plugin/plugin.json needs description"],
  [".claude-plugin/plugin.json", (j) => delete j.author, ".claude-plugin/plugin.json needs author"],
  [".claude-plugin/marketplace.json", (j) => delete j.owner, "marketplace.json needs owner"],
  [".claude-plugin/marketplace.json", (j) => (j.owner = {}), "marketplace.json owner must be an object with a non-empty name"],
  [".claude-plugin/marketplace.json", (j) => (j.owner = { name: "" }), "marketplace.json owner must be an object with a non-empty name"],
  [".claude-plugin/marketplace.json", (j) => delete j.plugins[0].displayName, "entry needs displayName"],
  [".claude-plugin/marketplace.json", (j) => (j.plugins[0].displayName = "FTF"), 'entry displayName must be "Follow The Flow"'],
  [".claude-plugin/marketplace.json", (j) => delete j.plugins[0].description, "entry needs description"],
  [".claude-plugin/marketplace.json", (j) => delete j.plugins[0].category, 'category must be "productivity"'],
  [".claude-plugin/marketplace.json", (j) => (j.plugins[0].category = "other"), 'category must be "productivity"'],
  ["server.json", (j) => delete j.description, "server.json needs description"],
];

/** Endpoints that are not https://<host>/v<n>/mcp, though a pattern on the raw string could pass them. */
const BAD_ENDPOINTS = [
  "http://mcp-dev.follow-the-flow.app/v1/mcp",
  "https://mcp-dev.follow-the-flow.app/mcp",
  "https://mcp-dev.follow-the-flow.app/api/v1/mcp",
  "https://mcp-dev.follow-the-flow.app/v1/mcp?x=1",
  "https://mcp-dev.follow-the-flow.app?/v1/mcp",
  "https://mcp-dev.follow-the-flow.app#/v1/mcp",
  "https://mcp-dev.follow-the-flow.app\\evil/v1/mcp",
  "https://user:pw@mcp-dev.follow-the-flow.app/v1/mcp",
  "https://user@mcp-dev.follow-the-flow.app/v1/mcp",
  "https://:pw@mcp-dev.follow-the-flow.app/v1/mcp",
  "https://mcp-dev.follow-the-flow.app/v1/mcp#x",
  // An empty query or fragment: URL reports "" for both, but the client still sends the character.
  "https://mcp-dev.follow-the-flow.app/v1/mcp?",
  "https://mcp-dev.follow-the-flow.app/v1/mcp#",
  "https://mcp-dev.follow-the-flow.app:99999/v1/mcp",
  "https://MCP-DEV.follow-the-flow.app/v1/mcp",
];

for (const url of BAD_ENDPOINTS) {
  test(`the endpoint ${url} in all three manifests is an error`, async () => {
    const errors = await errorsOf(async (dir) => {
      for (const file of ["mcp.json", ".claude-plugin/plugin.json"]) {
        await rewrite(dir, file, (j) => {
          j.mcpServers["follow-the-flow"].url = url;
        });
      }
      await rewrite(dir, "server.json", (j) => {
        j.remotes[0].url = url;
      });
    });
    assert.ok(
      errors.some((e) => e.includes("https://<host>/v<n>/mcp")),
      errors.join("\n"),
    );
  });
}

test("the missing owner email is a warning, not an error (I spec §9.2)", async () => {
  const { errors, warnings } = await validateRepository(repoRoot);
  assert.deepEqual(errors, []);
  assert.ok(
    warnings.some((w) => w.includes("owner has no email")),
    warnings.join("\n"),
  );
});

for (const [file, change, word] of BROKEN) {
  test(`${file}: ${change.toString()} is an error naming "${word}"`, async () => {
    const errors = await errorsOf((dir) => rewrite(dir, file, change));
    assert.ok(
      errors.some((e) => (typeof word === "string" ? e.includes(word) : word.test(e))),
      errors.join("\n"),
    );
  });
}

// I spec I-6: Claude Code would load a root .mcp.json first, and in this repo as a project server.
for (const [kind, create] of [
  ["file", (file) => writeFile(file, "{}")],
  ["dangling symlink", (file) => symlink("missing.json", file)],
]) {
  test(`a root .mcp.json that is a ${kind} is an error`, async () => {
    const errors = await errorsOf((dir) => create(path.join(dir, ".mcp.json")));
    assert.ok(
      errors.some((e) => e.startsWith(".mcp.json must not exist")),
      errors.join("\n"),
    );
  });
}

// Not also as a missing server, a wrong transport, or an endpoint that "differs" between two equal URLs.
for (const value of ["./.mcp.json", [{ type: "http", url: "https://mcp-dev.follow-the-flow.app/v1/mcp" }]]) {
  test(`mcpServers ${JSON.stringify(value)} is reported once, as not an inline map`, async () => {
    const errors = await errorsOf((dir) =>
      rewrite(dir, ".claude-plugin/plugin.json", (j) => {
        j.mcpServers = value;
      }),
    );
    assert.deepEqual(errors, [".claude-plugin/plugin.json mcpServers must be an inline map"]);
  });
}

for (const [change, error] of [
  [(j) => (j.mcpServers = "./x.json"), "mcp.json mcpServers must be a map of servers"],
  [(j) => delete j.mcpServers, "mcp.json needs mcpServers"],
]) {
  test(`mcp.json: ${change.toString()} is reported once`, async () => {
    const errors = await errorsOf((dir) => rewrite(dir, "mcp.json", change));
    assert.deepEqual(errors, [error]);
  });
}

test("a root .mcp.json does not hide the other errors", async () => {
  const errors = await errorsOf(async (dir) => {
    await writeFile(path.join(dir, ".mcp.json"), "{}");
    await rewrite(dir, ".claude-plugin/plugin.json", (j) => {
      j.mcpServers["follow-the-flow"].url = "https://mcp.follow-the-flow.app/v1/mcp";
    });
  });
  assert.ok(errors.some((e) => e.startsWith(".mcp.json must not exist")), errors.join("\n"));
  assert.ok(errors.some((e) => e.startsWith("MCP endpoint differs")), errors.join("\n"));
});

test("a root .mcp.json is reported alongside a missing file", async () => {
  const errors = await errorsOf(async (dir) => {
    await writeFile(path.join(dir, ".mcp.json"), "{}");
    await rm(path.join(dir, "server.json"));
  });
  assert.ok(errors.includes("missing server.json"), errors.join("\n"));
  assert.ok(errors.some((e) => e.startsWith(".mcp.json must not exist")), errors.join("\n"));
});

test("a manifest that is not JSON is an error", async () => {
  const errors = await errorsOf((dir) => writeFile(path.join(dir, "server.json"), "{"));
  assert.ok(
    errors.some((e) => e.includes("server.json is not valid JSON")),
    errors.join("\n"),
  );
});

test("a manifest that is JSON but not an object is an error, not a crash", async () => {
  const errors = await errorsOf((dir) => writeFile(path.join(dir, "plugin.json"), "null"));
  assert.ok(
    errors.some((e) => e.includes("plugin.json must be a JSON object")),
    errors.join("\n"),
  );
});

test("a file that exists but cannot be read is not reported as missing", async () => {
  const errors = await errorsOf(async (dir) => {
    await rm(path.join(dir, "server.json"));
    await mkdir(path.join(dir, "server.json"));
  });
  assert.ok(
    errors.some((e) => e.startsWith("cannot read server.json")),
    errors.join("\n"),
  );
  assert.ok(!errors.some((e) => e === "missing server.json"), errors.join("\n"));
});

test("a file whose existence cannot be checked is not reported as missing", async () => {
  // A symlink to itself: access() fails with ELOOP, not ENOENT.
  const errors = await errorsOf(async (dir) => {
    await rm(path.join(dir, "server.json"));
    await symlink("server.json", path.join(dir, "server.json"));
  });
  assert.ok(
    errors.some((e) => e.startsWith("cannot read server.json")),
    errors.join("\n"),
  );
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { checkEndpoint, metadataUrl, runEndpointCheck } from "./endpoint.mjs";

const ENDPOINT = "https://mcp-dev.follow-the-flow.app/v1/mcp";
const repoRoot = path.resolve(import.meta.dirname, "../..");

/** A fetch that answers with `body` and `status`, and records every URL it was asked for. */
function fakeFetch(body, status = 200) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { fetchImpl, urls };
}

/** Runs checkEndpoint with `fake` and asserts it asked for the metadata URL and nothing else. */
async function check(fake, endpoint = ENDPOINT) {
  const errors = await checkEndpoint(endpoint, fake.fetchImpl);
  assert.deepEqual(fake.urls, [metadataUrl(endpoint)]);
  return errors;
}

test("the metadata URL inserts the RFC 9728 well-known path before the endpoint's path", () => {
  assert.equal(
    metadataUrl(ENDPOINT),
    "https://mcp-dev.follow-the-flow.app/.well-known/oauth-protected-resource/v1/mcp",
  );
});

test("an endpoint the server names as its resource passes", async () => {
  assert.deepEqual(await check(fakeFetch({ resource: ENDPOINT })), []);
});

test("an endpoint that differs from the server's resource is an error naming both", async () => {
  const errors = await check(fakeFetch({ resource: "https://mcp.follow-the-flow.app/v1/mcp" }));
  assert.ok(
    errors.some((e) => e.includes(ENDPOINT) && e.includes("https://mcp.follow-the-flow.app/v1/mcp")),
    errors.join("\n"),
  );
});

for (const body of [{}, null, []]) {
  test(`metadata ${JSON.stringify(body)} without a resource is an error, not a pass`, async () => {
    const errors = await check(fakeFetch(body));
    assert.ok(
      errors.some((e) => e.includes("resource")),
      errors.join("\n"),
    );
  });
}

for (const status of [401, 404, 503]) {
  test(`metadata answered with HTTP ${status} is an error, not a pass`, async () => {
    const errors = await check(fakeFetch({ resource: ENDPOINT }, status));
    assert.ok(
      errors.some((e) => e.includes(`HTTP ${status}`)),
      errors.join("\n"),
    );
  });
}

test("metadata that is not JSON is an error", async () => {
  const errors = await check(fakeFetch("<html>"));
  assert.ok(
    errors.some((e) => e.includes("not valid JSON")),
    errors.join("\n"),
  );
});

test("a connection that breaks while reading the body is not reported as bad JSON", async () => {
  const errors = await checkEndpoint(ENDPOINT, async () => ({
    ok: true,
    status: 200,
    text: async () => {
      throw new TypeError("terminated");
    },
  }));
  assert.ok(
    errors.some((e) => e.startsWith("cannot read") && e.includes("terminated")),
    errors.join("\n"),
  );
  assert.ok(!errors.some((e) => e.includes("not valid JSON")), errors.join("\n"));
});

test("a failed request names its underlying cause", async () => {
  const errors = await checkEndpoint(ENDPOINT, async () => {
    throw new TypeError("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } });
  });
  assert.ok(
    errors.some((e) => e.includes("fetch failed") && e.includes("CERT_HAS_EXPIRED")),
    errors.join("\n"),
  );
});

test("an endpoint that is not a URL is an error, not a crash", async () => {
  const errors = await checkEndpoint("https://host:99999/v1/mcp", async () => {
    throw new Error("must not fetch");
  });
  assert.ok(
    errors.some((e) => e.startsWith("invalid endpoint")),
    errors.join("\n"),
  );
});

test("the full check validates the manifests first and does not fetch when they fail", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ftf-endpoint-"));
  try {
    const fake = fakeFetch({ resource: ENDPOINT });
    const errors = await runEndpointCheck(dir, fake.fetchImpl);
    assert.ok(
      errors.some((e) => e.startsWith("missing ")),
      errors.join("\n"),
    );
    assert.deepEqual(fake.urls, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the full check compares this repository's endpoint with the server's resource", async () => {
  const fake = fakeFetch({ resource: "https://mcp.follow-the-flow.app/v1/mcp" });
  const errors = await runEndpointCheck(repoRoot, fake.fetchImpl);
  assert.deepEqual(fake.urls, [metadataUrl(ENDPOINT)]);
  assert.ok(
    errors.some((e) => e.includes(ENDPOINT)),
    errors.join("\n"),
  );
});

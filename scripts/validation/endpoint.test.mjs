import assert from "node:assert/strict";
import { test } from "node:test";

import { checkEndpoint, metadataUrl } from "./endpoint.mjs";

const ENDPOINT = "https://mcp-dev.follow-the-flow.app/v1/mcp";

/** A fetch that answers one URL with `body` and `status`, and fails the test on any other URL. */
function fakeFetch(body, status = 200) {
  return async (url) => {
    assert.equal(url, metadataUrl(ENDPOINT));
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}

test("the metadata URL inserts the RFC 9728 well-known path before the endpoint's path", () => {
  assert.equal(
    metadataUrl(ENDPOINT),
    "https://mcp-dev.follow-the-flow.app/.well-known/oauth-protected-resource/v1/mcp",
  );
});

test("an endpoint the server names as its resource passes", async () => {
  assert.deepEqual(await checkEndpoint(ENDPOINT, fakeFetch({ resource: ENDPOINT })), []);
});

test("an endpoint that differs from the server's resource is an error naming both", async () => {
  const errors = await checkEndpoint(
    ENDPOINT,
    fakeFetch({ resource: "https://mcp.follow-the-flow.app/v1/mcp" }),
  );
  assert.ok(
    errors.some((e) => e.includes(ENDPOINT) && e.includes("https://mcp.follow-the-flow.app/v1/mcp")),
    errors.join("\n"),
  );
});

test("metadata that is not served is an error, not a pass", async () => {
  const errors = await checkEndpoint(ENDPOINT, fakeFetch("not found", 404));
  assert.ok(
    errors.some((e) => e.includes("404")),
    errors.join("\n"),
  );
});

test("metadata that is not JSON is an error", async () => {
  const errors = await checkEndpoint(ENDPOINT, fakeFetch("<html>"));
  assert.ok(
    errors.some((e) => e.includes("not valid JSON")),
    errors.join("\n"),
  );
});

test("a failed request is an error, not a crash", async () => {
  const errors = await checkEndpoint(ENDPOINT, async () => {
    throw new TypeError("fetch failed");
  });
  assert.ok(
    errors.some((e) => e.includes("fetch failed")),
    errors.join("\n"),
  );
});

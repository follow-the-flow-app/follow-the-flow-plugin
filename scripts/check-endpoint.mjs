#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

import { checkEndpoint } from "./validation/endpoint.mjs";

// `npm run validate` makes the three manifests name one endpoint; this compares it with the live server.
const server = JSON.parse(await readFile("server.json", "utf8"));
const endpoint = server.remotes?.[0]?.url;
const errors = endpoint ? await checkEndpoint(endpoint) : ["server.json has no remote URL"];
if (errors.length > 0) {
  console.error("Endpoint check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Endpoint check passed: ${endpoint} is the server's resource.`);
}

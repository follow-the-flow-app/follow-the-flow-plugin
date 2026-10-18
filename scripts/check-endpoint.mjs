#!/usr/bin/env node
import process from "node:process";

import { runEndpointCheck } from "./validation/endpoint.mjs";

const errors = await runEndpointCheck(process.cwd());
if (errors.length > 0) {
  console.error("Endpoint check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Endpoint check passed: the manifests name the server's resource.");
}

#!/usr/bin/env node
import process from "node:process";

import { validateRepository } from "./validation/repository.mjs";

const { errors, warnings } = await validateRepository(process.cwd());
for (const warning of warnings) console.log(`warning: ${warning}`);
if (errors.length > 0) {
  console.error("Validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Validation passed.");
}

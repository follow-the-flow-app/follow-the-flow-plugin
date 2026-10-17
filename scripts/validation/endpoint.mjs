import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateRepository } from "./repository.mjs";

/** RFC 9728: the protected resource metadata of `endpoint`, with the well-known path before the endpoint's path. */
export function metadataUrl(endpoint) {
  const url = new URL(endpoint);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}

/**
 * The manifests' MCP endpoint must be the resource the live server names in its public
 * metadata, which is the server's MCP_RESOURCE_URL (I spec I-2). Needs no token. This shows
 * the manifests agree with the server they name; it cannot tell whether that is the right environment.
 */
export async function checkEndpoint(endpoint, fetchImpl = fetch) {
  let url;
  try {
    url = metadataUrl(endpoint);
  } catch (error) {
    return [`invalid endpoint ${endpoint}: ${error.message}`];
  }
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    // Node's fetch says only "fetch failed"; the reason (DNS, an expired certificate) is in cause.
    const cause = error.cause ? ` (${error.cause.code ?? error.cause.message})` : "";
    return [`cannot fetch ${url}: ${error.message}${cause}`];
  }
  if (!response.ok) return [`${url} returned HTTP ${response.status}`];
  let text;
  try {
    text = await response.text();
  } catch (error) {
    return [`cannot read the body of ${url}: ${error.message}`];
  }
  let metadata;
  try {
    metadata = JSON.parse(text);
  } catch (error) {
    return [`${url} is not valid JSON: ${error.message}`];
  }
  if (metadata?.resource !== endpoint)
    return [`manifests name ${endpoint}, but the server's resource is ${metadata?.resource}`];
  return [];
}

/** `npm run validate`, then the endpoint the three manifests agree on against the live server. */
export async function runEndpointCheck(root, fetchImpl = fetch) {
  const { errors } = await validateRepository(root);
  if (errors.length > 0) return errors;
  const server = JSON.parse(await readFile(path.join(root, "server.json"), "utf8"));
  return checkEndpoint(server.remotes[0].url, fetchImpl);
}

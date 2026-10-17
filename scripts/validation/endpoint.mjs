/** RFC 9728: the protected resource metadata of `endpoint`, with the well-known path before the endpoint's path. */
export function metadataUrl(endpoint) {
  const url = new URL(endpoint);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}

/**
 * The manifests' MCP endpoint must be the resource the live server names in its public
 * metadata, which is the server's MCP_RESOURCE_URL (I spec I-2). Needs no token.
 */
export async function checkEndpoint(endpoint, fetchImpl = fetch) {
  const url = metadataUrl(endpoint);
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    return [`cannot fetch ${url}: ${error.message}`];
  }
  if (!response.ok) return [`${url} returned HTTP ${response.status}`];
  let metadata;
  try {
    metadata = JSON.parse(await response.text());
  } catch (error) {
    return [`${url} is not valid JSON: ${error.message}`];
  }
  if (metadata?.resource !== endpoint)
    return [`manifests name ${endpoint}, but the server's resource is ${metadata?.resource}`];
  return [];
}

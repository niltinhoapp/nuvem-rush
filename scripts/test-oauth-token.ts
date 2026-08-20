import assert from "node:assert/strict";
import {
  exchangeCodeForToken,
  NuvemshopOAuthResponseError,
  parseNuvemshopTokenResponse,
} from "../lib/nuvemshop/oauth";

const officialResponse = {
  access_token: "official-access-token",
  token_type: "bearer",
  scope: "read_orders,write_webhooks",
  user_id: 7_865_512,
};

assert.deepEqual(parseNuvemshopTokenResponse(officialResponse), officialResponse);

for (const invalidResponse of [
  { ...officialResponse, access_token: undefined },
  { ...officialResponse, access_token: "" },
  { ...officialResponse, access_token: "   " },
  { ...officialResponse, user_id: undefined },
  { ...officialResponse, user_id: "7865512" },
  { ...officialResponse, user_id: 0 },
  { ...officialResponse, scope: undefined },
  { ...officialResponse, scope: ["read_orders", "write_webhooks"] },
  { error: "invalid_grant", error_description: "invalid authorization code" },
  "unexpected-response",
]) {
  assert.throws(
    () => parseNuvemshopTokenResponse(invalidResponse),
    NuvemshopOAuthResponseError,
  );
}

const originalFetch = globalThis.fetch;
const originalAppId = process.env.NUVEMSHOP_APP_ID;
const originalSecret = process.env.NUVEMSHOP_CLIENT_SECRET;
process.env.NUVEMSHOP_APP_ID = "34663";
process.env.NUVEMSHOP_CLIENT_SECRET = "client-secret-not-for-logs";

async function exchangeThenPersist(response: unknown) {
  let writes = 0;
  globalThis.fetch = async () => new Response(JSON.stringify(response), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    const token = await exchangeCodeForToken("authorization-code-not-for-logs");
    writes += 1;
    return { token, writes };
  } catch (error) {
    return { error, writes };
  }
}

async function main() {
try {
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(JSON.stringify(officialResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await exchangeCodeForToken("authorization-code-not-for-logs");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.ok(requestInit?.body instanceof URLSearchParams);
  const requestBody = requestInit.body as URLSearchParams;
  assert.equal(requestBody.get("client_id"), "34663");
  assert.equal(requestBody.get("client_secret"), "client-secret-not-for-logs");
  assert.equal(requestBody.get("code"), "authorization-code-not-for-logs");
  assert.equal(requestBody.has("grant_type"), false);

  const valid = await exchangeThenPersist(officialResponse);
  assert.equal(valid.writes, 1);
  assert.equal(valid.token?.access_token, officialResponse.access_token);

  for (const response of [
    { ...officialResponse, access_token: undefined },
    { ...officialResponse, access_token: "" },
    { ...officialResponse, user_id: undefined },
    { ...officialResponse, user_id: "invalid" },
    { ...officialResponse, scope: undefined },
    { ...officialResponse, scope: ["read_orders"] },
    { error: "invalid_grant", error_description: "invalid authorization code" },
    { unexpected: true },
  ]) {
    const invalid = await exchangeThenPersist(response);
    assert.equal(invalid.writes, 0, "resposta invalida nao pode alcancar persistencia");
    assert.ok(invalid.error instanceof NuvemshopOAuthResponseError);
    assert.doesNotMatch(String(invalid.error), /official-access-token|client-secret|authorization-code/);
  }

  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: "client-secret-not-for-logs", access_token: "official-access-token" }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
  await assert.rejects(
    exchangeCodeForToken("authorization-code-not-for-logs"),
    (error: unknown) => {
      assert.doesNotMatch(String(error), /official-access-token|client-secret|authorization-code/);
      return true;
    },
  );

  delete process.env.NUVEMSHOP_CLIENT_SECRET;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response();
  };
  await assert.rejects(
    exchangeCodeForToken("authorization-code-not-for-logs"),
    NuvemshopOAuthResponseError,
  );
  assert.equal(fetchCalled, false, "credencial ausente deve falhar antes da rede");
} finally {
  globalThis.fetch = originalFetch;
  if (originalAppId === undefined) delete process.env.NUVEMSHOP_APP_ID;
  else process.env.NUVEMSHOP_APP_ID = originalAppId;
  if (originalSecret === undefined) delete process.env.NUVEMSHOP_CLIENT_SECRET;
  else process.env.NUVEMSHOP_CLIENT_SECRET = originalSecret;
}

console.log("oauth token response validation: OK");
}

void main();

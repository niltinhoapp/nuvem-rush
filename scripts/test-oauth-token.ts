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

// user_id como STRING numerica: a doc oficial
// (tiendanube.github.io/api-documentation/authentication) mostra o exemplo
// real como `"user_id": "789"` — string, nao number. Achado real ao
// homologar (NuvemshopOAuthResponseError em producao) confirmou que a API
// realmente devolve string. Normaliza para number, nunca relaxa o resto.
for (const [userId, expectedNormalized] of [
  ["7865512", 7_865_512],
  ["1", 1],
  ["007", 7], // zeros a esquerda ainda sao um inteiro positivo valido
  ["999999999999999", 999_999_999_999_999], // 15 digitos, dentro de MAX_SAFE_INTEGER
] as const) {
  assert.deepEqual(
    parseNuvemshopTokenResponse({ ...officialResponse, user_id: userId }),
    { ...officialResponse, user_id: expectedNormalized },
    `user_id string "${userId}" deveria normalizar para ${expectedNormalized}`,
  );
}

for (const invalidResponse of [
  { ...officialResponse, access_token: undefined },
  { ...officialResponse, access_token: "" },
  { ...officialResponse, access_token: "   " },
  { ...officialResponse, user_id: undefined },
  { ...officialResponse, user_id: null },
  { ...officialResponse, user_id: 0 },
  { ...officialResponse, user_id: "0" },
  { ...officialResponse, user_id: -1 },
  { ...officialResponse, user_id: "-1" },
  { ...officialResponse, user_id: 1.5 },
  { ...officialResponse, user_id: "1.5" },
  { ...officialResponse, user_id: "" },
  { ...officialResponse, user_id: "   " },
  { ...officialResponse, user_id: "abc" },
  { ...officialResponse, user_id: "7865512abc" },
  { ...officialResponse, user_id: "abc7865512" },
  { ...officialResponse, user_id: "1e10" }, // notacao cientifica: rejeitada, nao e so digitos
  { ...officialResponse, user_id: "9999999999999999" }, // 16 digitos: > MAX_SAFE_INTEGER
  { ...officialResponse, user_id: Number.MAX_SAFE_INTEGER + 1 },
  { ...officialResponse, user_id: Number.NaN },
  { ...officialResponse, user_id: Number.POSITIVE_INFINITY },
  { ...officialResponse, user_id: [7_865_512] },
  { ...officialResponse, user_id: { id: 7_865_512 } },
  { ...officialResponse, scope: undefined },
  { ...officialResponse, scope: ["read_orders", "write_webhooks"] },
  { error: "invalid_grant", error_description: "invalid authorization code" },
  "unexpected-response",
]) {
  assert.throws(
    () => parseNuvemshopTokenResponse(invalidResponse),
    NuvemshopOAuthResponseError,
    `deveria rejeitar: ${JSON.stringify(invalidResponse)}`,
  );
}

const originalFetch = globalThis.fetch;
const originalAppId = process.env.NUVEMSHOP_APP_ID;
const originalSecret = process.env.NUVEMSHOP_CLIENT_SECRET;
const originalAppBaseUrl = process.env.APP_BASE_URL;
process.env.NUVEMSHOP_APP_ID = "34663";
process.env.NUVEMSHOP_CLIENT_SECRET = "client-secret-not-for-logs";
process.env.APP_BASE_URL = "https://preview.example.com/";

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
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(typeof requestInit?.body, "string");
  const requestBody = JSON.parse(requestInit?.body as string) as Record<string, unknown>;
  assert.deepEqual(Object.keys(requestBody).sort(), [
    "client_id",
    "client_secret",
    "code",
    "grant_type",
    "redirect_uri",
  ]);
  assert.equal(requestBody.client_id, "34663");
  assert.equal(requestBody.client_secret, "client-secret-not-for-logs");
  assert.equal(requestBody.code, "authorization-code-not-for-logs");
  assert.equal(requestBody.grant_type, "authorization_code");
  assert.equal(
    requestBody.redirect_uri,
    "https://preview.example.com/api/auth/nuvemshop/callback",
  );

  const valid = await exchangeThenPersist(officialResponse);
  assert.equal(valid.writes, 1);
  assert.equal(valid.token?.access_token, officialResponse.access_token);

  // Ponta a ponta com o formato real da Nuvemshop (user_id como string) —
  // o caso que causava "falha na instalacao" em producao antes desta correcao.
  const validStringUserId = await exchangeThenPersist({ ...officialResponse, user_id: "7865512" });
  assert.equal(validStringUserId.writes, 1, "user_id string deve completar a troca normalmente");
  assert.equal(validStringUserId.token?.user_id, 7_865_512, "normaliza para number");

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

  process.env.NUVEMSHOP_CLIENT_SECRET = "client-secret-not-for-logs";
  delete process.env.APP_BASE_URL;
  await assert.rejects(
    exchangeCodeForToken("authorization-code-not-for-logs"),
    NuvemshopOAuthResponseError,
  );
  assert.equal(fetchCalled, false, "callback ausente deve falhar antes da rede");
} finally {
  globalThis.fetch = originalFetch;
  if (originalAppId === undefined) delete process.env.NUVEMSHOP_APP_ID;
  else process.env.NUVEMSHOP_APP_ID = originalAppId;
  if (originalSecret === undefined) delete process.env.NUVEMSHOP_CLIENT_SECRET;
  else process.env.NUVEMSHOP_CLIENT_SECRET = originalSecret;
  if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalAppBaseUrl;
}

console.log("oauth token response validation: OK");
}

void main();

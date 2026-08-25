// Teste do validador de session token do Nexo (HS256).
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { resolveStoreId } from "../lib/auth/session";
import { verifySessionToken } from "../lib/auth/sessionToken";

const SECRET = "segredo-de-teste-123";

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function makeJwt(payload: Record<string, unknown>, secret = SECRET): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function makeJwtWithRawPayload(rawPayload: string, secret = SECRET): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(rawPayload);
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

let pass = 0, fail = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FALL"}  ${label}`);
  ok ? pass++ : fail++;
};

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 10;
const now = Math.floor(Date.now() / 1000);

delete process.env.NUVEMSHOP_CLIENT_SECRET;
check("secret ausente rejeita token forjado com chave vazia",
  verifySessionToken(makeJwt({ store_id: 1, exp: future }, "")) === null);

process.env.NUVEMSHOP_CLIENT_SECRET = "";
check("secret vazio rejeita token forjado com chave vazia",
  verifySessionToken(makeJwt({ store_id: 1, exp: future }, "")) === null);

process.env.NUVEMSHOP_CLIENT_SECRET = "   ";
check("secret somente com espacos rejeita",
  verifySessionToken(makeJwt({ store_id: 1, exp: future }, "   ")) === null);

process.env.NUVEMSHOP_CLIENT_SECRET = SECRET;

check("token valido extrai storeId (store_id)",
  verifySessionToken(makeJwt({ store_id: 12345, exp: future }))?.storeId === "12345");

check("token valido extrai storeId (storeId camelCase)",
  verifySessionToken(makeJwt({ storeId: 999, exp: future }))?.storeId === "999");

check("sub sozinho NAO e aceito (nao e o claim de loja)",
  verifySessionToken(makeJwt({ sub: 999, exp: future })) === null);

check("assinatura errada e rejeitada",
  verifySessionToken(makeJwt({ store_id: 1, exp: future }, "secret-errado")) === null);

check("token expirado e rejeitado",
  verifySessionToken(makeJwt({ store_id: 1, exp: past })) === null);

check("exp exatamente no instante atual e rejeitado",
  verifySessionToken(makeJwt({ store_id: 1, exp: now })) === null);

check("exp ausente e rejeitado",
  verifySessionToken(makeJwt({ store_id: 1 })) === null);

check("exp string e rejeitado",
  verifySessionToken(makeJwt({ store_id: 1, exp: String(future) })) === null);

// JSON nao representa NaN. O parser real o rejeita antes da validacao de
// claims; Number.isFinite permanece necessario para numeros JSON que estouram.
check("exp NaN invalido no JSON e rejeitado",
  verifySessionToken(makeJwtWithRawPayload('{"store_id":1,"exp":NaN}')) === null);

check("exp Infinity por overflow JSON e rejeitado",
  verifySessionToken(makeJwtWithRawPayload('{"store_id":1,"exp":1e400}')) === null);

check("exp -Infinity por overflow JSON e rejeitado",
  verifySessionToken(makeJwtWithRawPayload('{"store_id":1,"exp":-1e400}')) === null);

check("payload JSON invalido e rejeitado",
  verifySessionToken(makeJwtWithRawPayload("{invalido")) === null);

check("token malformado e rejeitado",
  verifySessionToken("nao.e.jwt") === null);

check("sem store_id e rejeitado",
  verifySessionToken(makeJwt({ foo: "bar", exp: future })) === null);

// Token Bearer invalido nunca pode cair no atalho de desenvolvimento.
const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = mutableEnv.NODE_ENV;
mutableEnv.NODE_ENV = "development";
check("bearer invalido nao cai no fallback dev",
  resolveStoreId(new NextRequest("https://app.test/api/flows?storeId=query-store", {
    headers: { authorization: "Bearer invalido", "x-store-id": "header-store" },
  })) === null);

mutableEnv.NODE_ENV = "production";
check("production ignora x-store-id e query storeId",
  resolveStoreId(new NextRequest("https://app.test/api/flows?storeId=query-store", {
    headers: { "x-store-id": "header-store" },
  })) === null);

if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
else mutableEnv.NODE_ENV = originalNodeEnv;

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

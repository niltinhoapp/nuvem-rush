// Teste do validador de session token do Nexo (HS256).
import { createHmac } from "node:crypto";
import { verifySessionToken } from "../lib/auth/sessionToken";

const SECRET = "segredo-de-teste-123";
// verifySessionToken le o env no momento da chamada, entao basta setar antes dos checks.
process.env.NUVEMSHOP_CLIENT_SECRET = SECRET;

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function makeJwt(payload: Record<string, unknown>, secret = SECRET): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
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

check("token malformado e rejeitado",
  verifySessionToken("nao.e.jwt") === null);

check("sem store_id e rejeitado",
  verifySessionToken(makeJwt({ foo: "bar", exp: future })) === null);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

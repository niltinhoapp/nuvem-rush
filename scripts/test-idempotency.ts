// Teste da idempotencia de webhook (B2). Usa a impl em memoria, que replica a
// semantica atomica de create-if-not-exists da impl Firestore.
import { eventKey, createInMemoryEventClaim } from "../lib/webhooks/idempotency";
import { verifyHmac } from "../lib/nuvemshop/webhooks";
import { createHmac } from "node:crypto";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

async function main() {
// ---- Chave deterministica ----
check("eventKey deterministica", eventKey("order/paid", 123) === eventKey("order/paid", 123));
check("eventKey normaliza '/' (sem barra)", !eventKey("order/paid", 123).includes("/"));
check("eventos diferentes => chaves diferentes", eventKey("order/paid", 1) !== eventKey("order/fulfilled", 1));
check("recursos diferentes => chaves diferentes", eventKey("order/paid", 1) !== eventKey("order/paid", 2));

// ---- Primeira entrega vs duplicata ----
{
  const c = createInMemoryEventClaim();
  const k = eventKey("order/paid", 1001);
  const first = await c.claim("store1", k);
  const second = await c.claim("store1", k);
  const third = await c.claim("store1", k);
  check("1a entrega reivindica (true)", first === true);
  check("2a entrega e duplicata (false)", second === false);
  check("3a entrega e duplicata (false)", third === false);
}

// ---- Duplicatas CONCORRENTES: so uma vence ----
{
  const c = createInMemoryEventClaim();
  const k = eventKey("order/paid", 2002);
  const results = await Promise.all([
    c.claim("store1", k),
    c.claim("store1", k),
    c.claim("store1", k),
  ]);
  const wins = results.filter((r) => r === true).length;
  check("3 concorrentes => exatamente 1 vence", wins === 1);
}

// ---- Eventos legitimos DIFERENTES para o mesmo recurso nao sao descartados ----
{
  const c = createInMemoryEventClaim();
  const paid = await c.claim("store1", eventKey("order/paid", 3003));
  const fulfilled = await c.claim("store1", eventKey("order/fulfilled", 3003));
  check("paid e fulfilled do mesmo pedido: ambos processam", paid === true && fulfilled === true);
}

// ---- Isolamento por loja: mesma chave, lojas diferentes, ambas processam ----
{
  const c = createInMemoryEventClaim();
  const k = eventKey("order/paid", 4004);
  const s1 = await c.claim("storeA", k);
  const s2 = await c.claim("storeB", k);
  check("mesmo evento em lojas diferentes: ambas processam", s1 === true && s2 === true);
}

// ---- Release permite reprocessar (retry apos falha) ----
{
  const c = createInMemoryEventClaim();
  const k = eventKey("order/paid", 5005);
  await c.claim("store1", k);       // reivindica
  await c.release("store1", k);     // falhou -> libera
  const retry = await c.claim("store1", k);
  check("release permite reprocessar na reentrega", retry === true);
}

// ---- HMAC invalido continua rejeitado; valido aceito ----
{
  const secret = "s3cr3t";
  process.env.NUVEMSHOP_CLIENT_SECRET = secret;
  const body = JSON.stringify({ event: "order/paid", store_id: 1, id: 9 });
  const good = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  check("HMAC valido aceito", verifyHmac(body, good) === true);
  check("HMAC invalido rejeitado", verifyHmac(body, "deadbeef") === false);
  check("HMAC ausente rejeitado", verifyHmac(body, null) === false);
}

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();

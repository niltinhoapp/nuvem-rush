// Testes da AUTORIDADE server-side do sinal (bloqueadores 1-5).
import {
  reduceSignalDoc,
  isAbandonedServer,
  storeOwnsCheckout,
  CART_ABANDON_TIMEOUT_MS,
  type SignalDoc,
} from "../lib/storefront/signalDoc";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}
const base = (over: Partial<SignalDoc>): SignalDoc => ({
  storeId: "s", cartId: "c", receivedAt: 0, lastActivityAt: 0,
  reachedCheckout: true, clientCompleted: false, status: "pending", ...over,
});

// ===== Bloqueador 1: posse confirmada por API (identidade store-scoped) =====
{
  const storeA = new Set<string>(["A1", "A2"]);
  const storeB = new Set<string>(["123"]);
  check("1 loja A não é dona do checkout de B", storeOwnsCheckout(storeA, "123") === false);
  check("1 loja B é a dona (API confirma)", storeOwnsCheckout(storeB, "123") === true);
}

// ===== Bloqueador 4: timestamp do servidor é autoridade =====
{
  const d0 = reduceSignalDoc(null, { storeId: "s", cartId: "c", phase: "CHECKOUT_STARTED", receivedAt: 1000 });
  check("4 lastActivityAt = receivedAt do servidor", d0.lastActivityAt === 1000);
  const d1 = reduceSignalDoc(d0, { storeId: "s", cartId: "c", phase: "ACTIVITY", receivedAt: 5000 });
  check("4 atividade renova para o tempo do servidor", d1.lastActivityAt === 5000);
}

// ===== Bloqueador 3: terminal não regride =====
{
  const terminal = base({ status: "terminal", lastActivityAt: 1 });
  const after = reduceSignalDoc(terminal, { storeId: "s", cartId: "c", phase: "ACTIVITY", receivedAt: 9999 });
  check("3 terminal + atividade não regride", after.status === "terminal" && after.lastActivityAt === 1);
  const after2 = reduceSignalDoc(terminal, { storeId: "s", cartId: "c", phase: "CHECKOUT_STARTED", receivedAt: 9999 });
  check("3 terminal + checkout não regride", after2.status === "terminal");
}

// ===== Bloqueador 2: COMPLETED do browser é só HINT =====
{
  let d = reduceSignalDoc(null, { storeId: "s", cartId: "c", phase: "CHECKOUT_STARTED", receivedAt: 1000 });
  d = reduceSignalDoc(d, { storeId: "s", cartId: "c", phase: "COMPLETED", receivedAt: 2000 });
  check("2 COMPLETED do browser NÃO vira terminal", d.status === "pending" && d.clientCompleted === true);
  check("2 COMPLETED falso NÃO impede abandono", isAbandonedServer(d, 2000 + CART_ABANDON_TIMEOUT_MS) === true);
  check("2 terminal server-side encerra", isAbandonedServer(base({ status: "terminal" }), 10 ** 12) === false);
}

// ===== Bloqueador 5: atividade prolongada NÃO vira abandono =====
{
  let d = reduceSignalDoc(null, { storeId: "s", cartId: "c", phase: "CHECKOUT_STARTED", receivedAt: 0 });
  for (let t = 10 * 60_000; t <= 40 * 60_000; t += 10 * 60_000) {
    check(`5 ativo em t=${t / 60000}min NÃO é abandono`, isAbandonedServer(d, t) === false);
    d = reduceSignalDoc(d, { storeId: "s", cartId: "c", phase: "ACTIVITY", receivedAt: t });
  }
  check("5 após silêncio real >= timeout => abandono", isAbandonedServer(d, 40 * 60_000 + CART_ABANDON_TIMEOUT_MS) === true);
}

// ===== isAbandonedServer só com checkout iniciado =====
check("sem reachedCheckout => nunca abandono", isAbandonedServer(base({ reachedCheckout: false }), 10 ** 12) === false);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

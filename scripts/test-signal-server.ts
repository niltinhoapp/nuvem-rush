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

// ===== Bloqueador 1: identidade da loja (loja A não afeta loja B) =====
{
  const cartId = "chk-B-999";
  const storeA = new Set<string>(["chk-A-1", "chk-A-2"]); // não contém o checkout de B
  const storeB = new Set<string>(["chk-B-999"]);
  check("1 loja A NÃO é dona do checkout de B", storeOwnsCheckout(storeA, cartId) === false);
  check("1 loja B é a dona (API confirma)", storeOwnsCheckout(storeB, cartId) === true);
  // storeId reivindicado pelo cliente é irrelevante: só a posse via API decide.
  check("1 storeId do cliente não seleciona loja", storeOwnsCheckout(storeA, cartId) === false);
}

// ===== Bloqueador 4: timestamp do servidor é autoridade =====
{
  // Cliente "mente" o tempo? reduceSignalDoc só recebe receivedAt do servidor.
  const d0 = reduceSignalDoc(null, { cartId: "c", phase: "CHECKOUT_STARTED", receivedAt: 1000 });
  check("4 lastActivityAt usa receivedAt do servidor", d0.lastActivityAt === 1000);
  const d1 = reduceSignalDoc(d0, { cartId: "c", phase: "ACTIVITY", receivedAt: 5000 });
  check("4 atividade renova para o tempo do servidor", d1.lastActivityAt === 5000);
}

// ===== Bloqueador 3: terminal não regride (atômico no caller) =====
{
  const terminal: SignalDoc = { cartId: "c", receivedAt: 1, lastActivityAt: 1, reachedCheckout: true, clientCompleted: false, status: "terminal" };
  const afterUpdate = reduceSignalDoc(terminal, { cartId: "c", phase: "ACTIVITY", receivedAt: 9999 });
  check("3 terminal + cart:update não regride", afterUpdate.status === "terminal" && afterUpdate.lastActivityAt === 1);
  const afterCheckout = reduceSignalDoc(terminal, { cartId: "c", phase: "CHECKOUT_STARTED", receivedAt: 9999 });
  check("3 terminal + checkout:ready não regride", afterCheckout.status === "terminal");
}

// ===== Bloqueador 2: COMPLETED do browser é só HINT, não encerra =====
{
  let d = reduceSignalDoc(null, { cartId: "c", phase: "CHECKOUT_STARTED", receivedAt: 1000 });
  d = reduceSignalDoc(d, { cartId: "c", phase: "COMPLETED", receivedAt: 2000 });
  check("2 COMPLETED do browser NÃO vira terminal", d.status === "pending" && d.clientCompleted === true);
  const now = 2000 + CART_ABANDON_TIMEOUT_MS;
  check("2 COMPLETED falso NÃO impede abandono real", isAbandonedServer(d, now) === true);
  // Encerramento real: quando o servidor marca terminal.
  const closed: SignalDoc = { ...d, status: "terminal", terminalReason: "order_confirmed" };
  check("2 terminal server-side encerra (não é candidato)", isAbandonedServer(closed, now) === false);
}

// ===== Bloqueador 5: atividade prolongada NÃO vira abandono =====
{
  const timeout = CART_ABANDON_TIMEOUT_MS;
  let d = reduceSignalDoc(null, { cartId: "c", phase: "CHECKOUT_STARTED", receivedAt: 0 });
  // Usuário ativo por >30min com eventos a cada 10min.
  for (let t = 10 * 60_000; t <= 40 * 60_000; t += 10 * 60_000) {
    // Antes de renovar, no instante t não passou timeout desde a última atividade.
    check(`5 ativo em t=${t / 60000}min NÃO é abandono`, isAbandonedServer(d, t) === false);
    d = reduceSignalDoc(d, { cartId: "c", phase: "ACTIVITY", receivedAt: t });
  }
  // Depois que PARA (silêncio >= timeout), vira candidato.
  const last = 40 * 60_000;
  check("5 após silêncio real >= timeout => abandono", isAbandonedServer(d, last + timeout) === true);
}

// ===== isAbandonedServer: só com checkout iniciado =====
{
  const noCheckout: SignalDoc = { cartId: "c", receivedAt: 0, lastActivityAt: 0, reachedCheckout: false, clientCompleted: false, status: "pending" };
  check("sem reachedCheckout => nunca abandono", isAbandonedServer(noCheckout, 10 ** 12) === false);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

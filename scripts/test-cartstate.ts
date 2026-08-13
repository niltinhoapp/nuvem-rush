// Testes da máquina de estados do carrinho (Fase 2 / Fase 8, itens 1-8, 10).
import {
  reduceCart,
  initCartMachine,
  isAbandonedCandidate,
  CART_ABANDON_TIMEOUT_MS,
  type NubeCartEvent,
  type CartMachine,
} from "../lib/storefront/cartState";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

const ctx = (over: Partial<Parameters<typeof reduceCart>[2]> = {}) => ({
  storeId: "s1",
  cartId: "c1",
  hasItems: true,
  hasContact: false,
  now: 1000,
  ...over,
});

function step(state: CartMachine, event: NubeCartEvent, over = {}) {
  return reduceCart(state, event, ctx(over));
}

// 1) cart:update cria/atualiza atividade (ACTIVE, lastActivityAt).
{
  const r = step(initCartMachine(), "cart:update", { now: 500 });
  check("1 cart:update => ACTIVE + atividade", r.state.phase === "ACTIVE" && r.state.lastActivityAt === 500);
}

// 2) cart:update NÃO dispara abandono (nem sinal).
{
  const r = step(initCartMachine(), "cart:update");
  check("2 cart:update NÃO emite sinal", r.signal === undefined);
}

// 3) checkout:ready => CHECKOUT_STARTED + sinal.
{
  const r = step(initCartMachine(), "checkout:ready");
  check("3 checkout:ready => CHECKOUT_STARTED + sinal", r.state.phase === "CHECKOUT_STARTED" && r.signal?.phase === "CHECKOUT_STARTED");
}

// 4) customer:update não dispara mensagem (sem sinal) e marca contato.
{
  const r = step(initCartMachine(), "customer:update");
  check("4 customer:update sem sinal, hasContact=true", r.signal === undefined && r.state.hasContact === true);
}

// 5) checkout:success => COMPLETED + sinal.
{
  const r = step(initCartMachine(), "checkout:success");
  check("5 checkout:success => COMPLETED + sinal", r.state.phase === "COMPLETED" && r.signal?.phase === "COMPLETED");
}

// 6) order:update => COMPLETED + sinal.
{
  const r = step(initCartMachine(), "order:update");
  check("6 order:update => COMPLETED + sinal", r.state.phase === "COMPLETED" && r.signal?.phase === "COMPLETED");
}

// 7) COMPLETED nunca vira outra coisa (terminal), mesmo com checkout:ready depois.
{
  const done = step(initCartMachine(), "checkout:success").state;
  const after = step(done, "checkout:ready");
  check("7 COMPLETED é terminal (ignora eventos)", after.state.phase === "COMPLETED" && after.signal === undefined);
  check("7b COMPLETED nunca é candidato a abandono", isAbandonedCandidate("COMPLETED", 0, 10 ** 12, true) === false);
}

// 8) timeout correto => candidato a ABANDONO (server-side).
{
  const now = 100 * 60_000;
  const started = now - CART_ABANDON_TIMEOUT_MS; // exatamente no limite
  const recent = now - 60_000; // 1 min atrás
  check("8 CHECKOUT_STARTED além do timeout => candidato", isAbandonedCandidate("CHECKOUT_STARTED", started, now, false) === true);
  check("8b CHECKOUT_STARTED recente => NÃO candidato", isAbandonedCandidate("CHECKOUT_STARTED", recent, now, false) === false);
  check("8c completed=true => NÃO candidato", isAbandonedCandidate("CHECKOUT_STARTED", started, now, true) === false);
}

// 10) evento repetido é idempotente: checkout:ready 2x => sinal só 1x.
{
  const r1 = step(initCartMachine(), "checkout:ready");
  const r2 = step(r1.state, "checkout:ready");
  check("10 checkout:ready repetido não reenvia sinal", r1.signal !== undefined && r2.signal === undefined);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

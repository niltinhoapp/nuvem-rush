// Testes da máquina de estados do cliente (eventos oficiais NubeSDK v0.5.0).
import { reduceCart, initCartMachine, type NubeCartEvent, type CartMachine } from "../lib/storefront/cartState";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}
const ctx = (over = {}) => ({ storeId: "s1", cartId: "c1", hasItems: true, hasContact: false, now: 1000, ...over });
const step = (state: CartMachine, event: NubeCartEvent, over = {}) => reduceCart(state, event, ctx(over));

// cart:update -> ACTIVITY + ACTIVE (não é abandono; renova atividade).
{
  const r = step(initCartMachine(), "cart:update", { now: 500 });
  check("cart:update => ACTIVE + sinal ACTIVITY", r.state.phase === "ACTIVE" && r.signal?.phase === "ACTIVITY" && r.state.lastActivityAt === 500);
}
// cart:update sem itens -> sem sinal.
{
  const r = step(initCartMachine(), "cart:update", { hasItems: false });
  check("cart:update sem itens => sem sinal", r.signal === undefined);
}
// checkout:ready -> CHECKOUT_STARTED (1ª vez); repetido -> ACTIVITY (renova).
{
  const r1 = step(initCartMachine(), "checkout:ready");
  check("checkout:ready => CHECKOUT_STARTED", r1.state.phase === "CHECKOUT_STARTED" && r1.signal?.phase === "CHECKOUT_STARTED");
  const r2 = step(r1.state, "checkout:ready");
  check("checkout:ready repetido => ACTIVITY (renova)", r2.signal?.phase === "ACTIVITY");
}
// shipping:update / payment:update -> ACTIVITY (forte intenção, renova).
{
  const started = step(initCartMachine(), "checkout:ready").state;
  check("shipping:update => ACTIVITY", step(started, "shipping:update").signal?.phase === "ACTIVITY");
  check("payment:update => ACTIVITY", step(started, "payment:update").signal?.phase === "ACTIVITY");
}
// customer:update -> sem sinal antes do checkout; ACTIVITY depois.
{
  check("customer:update antes do checkout => sem sinal", step(initCartMachine(), "customer:update").signal === undefined);
  const started = step(initCartMachine(), "checkout:ready").state;
  const r = step(started, "customer:update");
  check("customer:update no checkout => ACTIVITY, hasContact", r.signal?.phase === "ACTIVITY" && r.state.hasContact === true);
}
// checkout:success -> COMPLETED (hint) + terminal local.
{
  const r = step(initCartMachine(), "checkout:success");
  check("checkout:success => COMPLETED", r.state.phase === "COMPLETED" && r.signal?.phase === "COMPLETED");
  const after = step(r.state, "cart:update");
  check("COMPLETED terminal local (não reemite)", after.signal === undefined && after.state.phase === "COMPLETED");
}
// sinal nunca carrega PII (só storeId/cartId/phase/clientAt/storeDomain).
{
  const r = step(initCartMachine(), "checkout:ready", { storeDomain: "loja.x" });
  const keys = Object.keys(r.signal ?? {}).sort().join(",");
  check("sinal só tem campos técnicos (sem PII)", keys === "cartId,clientAt,phase,storeDomain,storeId");
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

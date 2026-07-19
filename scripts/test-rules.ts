// Teste do contrato sync -> motor: monta pedidos no formato que syncOrder produz
// e verifica se os triggers dos 3 fluxos do briefing casam corretamente.
import { buildContext, matches } from "../lib/rules/evaluate";
import type { Contact, Order, Trigger } from "../types";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean, want: boolean) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FALL"}  ${label} (got=${got}, want=${want})`);
  ok ? pass++ : fail++;
}

const contactNovo: Contact = {
  contactId: "c1", nsCustomerId: "1", name: "Cliente Teste", email: "a@b.com", phone: null,
  tags: [], ordersCount: 1, totalSpent: 250, optOut: false, lastOrderAt: Date.now(),
};

// Pedido com SHAMPOO001, categoria energia-solar e total 250 (formato pos-sync).
const order: Order = {
  orderId: "o1", nsOrderId: "1001", contactId: "c1", total: 250, status: "paid",
  paidAt: Date.now(),
  items: [
    { sku: "SHAMPOO001", productId: "p1", categoryIds: ["energia-solar"], brand: "Acme", qty: 2, price: 100 },
    { sku: "OUTRO", productId: "p2", categoryIds: ["higiene"], brand: "Outra", qty: 1, price: 50 },
  ],
};

const ctx = buildContext(order, contactNovo);

// Fluxo 1: SE SKU = SHAMPOO001
const f1: Trigger = { event: "order_paid", match: "all",
  conditions: [{ field: "item.sku", op: "eq", value: "SHAMPOO001" }] };
check("Fluxo1 SKU=SHAMPOO001 casa", matches(f1, ctx), true);

// Fluxo 2: SE categoria = energia-solar
const f2: Trigger = { event: "order_paid", match: "all",
  conditions: [{ field: "item.category", op: "in", value: ["energia-solar"] }] };
check("Fluxo2 categoria energia-solar casa", matches(f2, ctx), true);

// Fluxo 3: SE produto p1 E valor >= 200
const f3: Trigger = { event: "order_paid", match: "all", conditions: [
  { field: "item.productId", op: "eq", value: "p1" },
  { field: "order.total", op: "gte", value: 200 },
] };
check("Fluxo3 produto+valor casa", matches(f3, ctx), true);

// Negativos
const fNeg: Trigger = { event: "order_paid", match: "all",
  conditions: [{ field: "item.sku", op: "eq", value: "NAO_EXISTE" }] };
check("SKU inexistente NAO casa", matches(fNeg, ctx), false);

const fMarca: Trigger = { event: "order_paid", match: "all",
  conditions: [{ field: "item.brand", op: "eq", value: "Acme" }] };
check("Marca Acme casa", matches(fMarca, ctx), true);

const fPrimeira: Trigger = { event: "order_paid", match: "all",
  conditions: [{ field: "customer.type", op: "eq", value: "first_purchase" }] };
check("Primeira compra casa", matches(fPrimeira, ctx), true);

const fMatchAny: Trigger = { event: "order_paid", match: "any", conditions: [
  { field: "item.sku", op: "eq", value: "NAO_EXISTE" },
  { field: "item.brand", op: "eq", value: "Acme" },
] };
check("match=any com 1 verdadeira casa", matches(fMatchAny, ctx), true);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

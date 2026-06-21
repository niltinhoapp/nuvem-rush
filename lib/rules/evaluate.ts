// Motor de regras: avalia o trigger de um Flow contra um pedido + contato.
import type { Condition, ConditionOp, Contact, Order, Trigger } from "@/types";

// "Achata" o pedido em um contexto plano consultavel pelas condicoes.
// Campos de item viram arrays (um pedido tem varios itens).
export function buildContext(order: Order, contact: Contact): Record<string, unknown> {
  return {
    "order.total": order.total,
    "order.itemsCount": order.items.reduce((s, i) => s + i.qty, 0),
    "item.sku": order.items.map((i) => i.sku).filter(Boolean),
    "item.productId": order.items.map((i) => i.productId).filter(Boolean),
    "item.category": order.items.flatMap((i) => i.categoryIds),
    "item.brand": order.items.map((i) => i.brand).filter(Boolean),
    "customer.type": contact.ordersCount <= 1 ? "first_purchase" : "recurring",
  };
}

function compare(actual: unknown, op: ConditionOp, expected: unknown): boolean {
  const arr = Array.isArray(actual) ? actual : [actual];
  switch (op) {
    case "eq":
      return arr.includes(expected);
    case "neq":
      return !arr.includes(expected);
    case "in":
      return Array.isArray(expected) && arr.some((x) => expected.includes(x));
    case "contains":
      return arr.some((x) => String(x).includes(String(expected)));
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    default:
      return false;
  }
}

function evalCondition(c: Condition, ctx: Record<string, unknown>): boolean {
  return compare(ctx[c.field], c.op, c.value);
}

export function matches(trigger: Trigger, ctx: Record<string, unknown>): boolean {
  if (trigger.conditions.length === 0) return true;
  const results = trigger.conditions.map((c) => evalCondition(c, ctx));
  return trigger.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

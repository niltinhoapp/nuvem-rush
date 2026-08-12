// Tipos centrais do dominio. Espelham as colecoes do Firestore.

export type Plan = "essencial" | "crescimento" | "turbo";

export interface Store {
  storeId: string; // = user_id retornado pela Nuvemshop
  ownerUid: string;
  accessToken: string; // criptografado em repouso
  scope: string;
  plan: Plan;
  status: "active" | "uninstalled";
  installedAt: number;
  quotas: {
    contactsLimit: number;
    // Cota de E-MAIL (nome legado "dispatches" mantido p/ compatibilidade
    // com documentos ja existentes no Firestore).
    dispatchesMonthLimit: number;
    dispatchesMonthUsed: number;
    // Cota de WHATSAPP — separada porque cada mensagem custa ~R$0,33 na Meta.
    whatsappMonthLimit: number;
    whatsappMonthUsed: number;
    // Periodo (YYYY-MM) a que os contadores acima se referem. Quando vira o
    // mes, os contadores sao zerados no proximo disparo (ver lib/dispatch.ts).
    periodKey?: string;
  };
  // Conta de WhatsApp PROPRIA do lojista, conectada via Embedded Signup
  // (modelo Tech Provider: a Meta cobra as mensagens direto do lojista).
  // Se ausente/disconnected, o canal cai no numero global do Nuvem Rush.
  whatsapp?: StoreWhatsapp;
}

export interface StoreWhatsapp {
  wabaId: string;
  phoneNumberId: string;
  // Business token do lojista (troca do code do Embedded Signup).
  // TODO: criptografar em repouso (KMS), como o accessToken da Nuvemshop.
  accessToken: string;
  status: "connected" | "disconnected";
  // Template padrao de pos-venda criado automaticamente na WABA do lojista.
  templateName?: string;
  templateLang?: string;
  connectedAt: number;
  // O token da config do Embedded Signup expira em 60 dias; o cron
  // /api/cron/refresh-whatsapp-tokens renova mensalmente via fb_exchange_token.
  tokenRefreshedAt?: number;
  // Visibilidade de falha de renovacao (para alertar antes de expirar).
  lastRefreshError?: string | null;
  lastRefreshAttempt?: number;
  refreshFailCount?: number;
}

export interface Product {
  productId: string;
  sku: string | null;
  name: string;
  brand: string | null;
  categoryIds: string[];
  price: number;
}

export interface Contact {
  contactId: string;
  nsCustomerId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  ordersCount: number;
  totalSpent: number;
  optOut: boolean;
  lastOrderAt: number | null;
}

export interface OrderItem {
  sku: string | null;
  productId: string | null;
  categoryIds: string[];
  brand: string | null;
  qty: number;
  price: number;
}

export interface Order {
  orderId: string;
  nsOrderId: string;
  contactId: string;
  total: number;
  items: OrderItem[];
  status: "paid" | "cancelled" | "open";
  paidAt?: number | null;
  // Logistica / rastreio (preenchido quando o pedido e enviado).
  fulfilledAt?: number | null;
  shippingStatus?: string | null;
  trackingCode?: string | null;
  trackingUrl?: string | null;
}

// Carrinho abandonado (Abandoned Checkout da Nuvemshop, obtido por poll).
export interface Cart {
  cartId: string;          // = id do checkout na Nuvemshop
  nsCheckoutId: string;
  contactId: string;
  total: number;
  items: OrderItem[];
  recoveryUrl: string | null; // abandoned_checkout_url (link de volta ao carrinho)
  createdAt: number;       // quando o checkout comecou
  abandonedAt: number;     // quando detectamos como abandonado
  status: "abandoned" | "recovered";
}

// ---- Motor de regras ----
export type ConditionOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";

export type ConditionField =
  | "order.total"
  | "order.itemsCount"
  | "item.sku"
  | "item.productId"
  | "item.category"
  | "item.brand"
  | "customer.type"; // first_purchase | recurring

export interface Condition {
  field: ConditionField;
  op: ConditionOp;
  value: string | number | string[] | number[];
}

export interface Trigger {
  event: "order_paid" | "order_created" | "order_fulfilled" | "cart_abandoned";
  match: "all" | "any";
  conditions: Condition[];
}

export type ActionType = "email" | "whatsapp" | "tag" | "webhook" | "task";
export type DelayUnit = "minutes" | "hours" | "days";

export interface Step {
  delay: { value: number; unit: DelayUnit };
  action: ActionType;
  templateId?: string;
  aiPrompt?: string; // se preenchido, conteudo gerado por IA
  config?: Record<string, unknown>; // ex.: tag a aplicar, url do webhook
}

export interface Flow {
  flowId: string;
  name: string;
  status: "active" | "paused" | "draft";
  trigger: Trigger;
  steps: Step[];
  stats: { enrolled: number; sent: number; failed: number };
  createdAt: number;
}

export interface Enrollment {
  enrollmentId: string;
  flowId: string;
  contactId: string;
  orderId?: string;   // origem: pedido (pos-venda) ...
  cartId?: string;    // ... ou carrinho abandonado
  currentStep: number;
  status: "active" | "completed" | "cancelled";
  startedAt: number;
}

export interface Job {
  jobId: string;
  storeId: string;
  enrollmentId: string;
  flowId: string;
  stepIndex: number;
  channel: ActionType;
  runAt: number;
  // "processing": reivindicado por um worker (claim atomico) e ainda em envio.
  // Estado intermediario que impede que dois crons/workers disparem o mesmo job.
  status: "scheduled" | "processing" | "sent" | "failed" | "cancelled";
  claimedAt?: number; // quando o job foi reivindicado (scheduled -> processing)
  // Retry (Fase E): tentativas ja feitas, ultimo erro e proxima tentativa
  // (backoff). Em retry o job volta a "scheduled" com runAt = nextAttemptAt.
  attempts?: number;
  lastError?: string;
  nextAttemptAt?: number;
  cloudTaskName?: string;
}

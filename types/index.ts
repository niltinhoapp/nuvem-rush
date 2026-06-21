// Tipos centrais do dominio. Espelham as colecoes do Firestore.

export type Plan = "free" | "pro" | "agency";

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
    dispatchesMonthLimit: number;
    dispatchesMonthUsed: number;
  };
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
  paidAt: number | null;
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
  event: "order_paid" | "order_created";
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
  orderId: string;
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
  status: "scheduled" | "sent" | "failed" | "cancelled";
  cloudTaskName?: string;
}

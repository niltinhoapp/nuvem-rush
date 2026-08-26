import {
  catalogTemplateForEvent,
  findCatalogTemplateByIdentity,
  isTemplateCatalogKey,
  type TemplateCatalogKey,
} from "./catalog";
import { TEMPLATE_NOT_APPROVED_ERROR } from "./templateStatus";
import type { Flow } from "@/types";

export const TEMPLATE_INPUT_MISSING_ERROR = "whatsapp_template_input_missing";

function requiredValue(value: string | null | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${TEMPLATE_INPUT_MISSING_ERROR}:${field}`);
  return normalized;
}

export function resolveCommercialTemplateKey(event: Flow["trigger"]["event"], config: Record<string, unknown> | undefined): TemplateCatalogKey {
  const mapped = catalogTemplateForEvent(event);
  const configuredKey = config?.whatsappTemplateKey;
  const configuredName = config?.whatsappTemplateName;
  const configuredLanguage = config?.whatsappTemplateLang;
  let explicit: TemplateCatalogKey | undefined;
  if (configuredKey !== undefined) {
    if (!isTemplateCatalogKey(configuredKey)) throw new Error(TEMPLATE_NOT_APPROVED_ERROR);
    explicit = configuredKey;
  } else if (typeof configuredName === "string") {
    const identity = findCatalogTemplateByIdentity(configuredName, typeof configuredLanguage === "string" ? configuredLanguage : "pt_BR");
    if (!identity) throw new Error(TEMPLATE_NOT_APPROVED_ERROR);
    explicit = identity.key;
  }
  if (mapped) {
    if (explicit && explicit !== mapped.key) throw new Error(TEMPLATE_NOT_APPROVED_ERROR);
    return mapped.key;
  }
  // order_created não recebe template por inferência. Pós-venda é sempre uma escolha explícita.
  if (explicit === "pos_venda_agradecimento") return explicit;
  throw new Error(TEMPLATE_NOT_APPROVED_ERROR);
}

export function buildCatalogTemplateParameters(
  key: TemplateCatalogKey,
  values: { name: string | null | undefined; recoveryUrl?: string | null; orderNumber?: string | null; trackingUrl?: string | null },
): string[] {
  const name = requiredValue(values.name, "name");
  switch (key) {
    case "carrinho_abandonado": return [name, requiredValue(values.recoveryUrl, "recovery_url")];
    case "pedido_pagamento_confirmado": return [name, requiredValue(values.orderNumber, "order_number")];
    case "pedido_enviado_rastreio": return [name, requiredValue(values.orderNumber, "order_number"), requiredValue(values.trackingUrl, "tracking_url")];
    case "pos_venda_agradecimento": return [name];
  }
}

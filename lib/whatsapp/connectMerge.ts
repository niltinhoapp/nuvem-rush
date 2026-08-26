import { WHATSAPP_TEMPLATE_CATALOG_KEYS, type TemplateCatalogKey } from "./catalog";
import type { CatalogTemplateProvision } from "./embedded";
import type { WhatsappCatalogTemplate } from "@/types";

// Resultados sem confirmação da Meta não carregam autoridade para modificar o
// estado persistido. A função é pura para que a regra seja testável sem SDK.
export function mergeConfirmedCatalogTemplates(params: {
  existing?: Partial<Record<TemplateCatalogKey, WhatsappCatalogTemplate>>;
  provision: CatalogTemplateProvision;
}): Partial<Record<TemplateCatalogKey, WhatsappCatalogTemplate>> {
  const merged = { ...(params.existing ?? {}) };
  for (const key of WHATSAPP_TEMPLATE_CATALOG_KEYS) {
    const outcome = params.provision[key];
    if (outcome.template && outcome.outcome !== "unconfirmed") merged[key] = outcome.template;
  }
  return merged;
}

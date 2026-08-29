import { findCatalogTemplateByIdentity, getCatalogTemplate, type TemplateCatalogKey } from "./catalog";
import type { StoreWhatsapp, WhatsappCatalogTemplate, WhatsappTemplateStatus } from "@/types";

export const TEMPLATE_NOT_APPROVED_ERROR = "whatsapp_template_not_approved";
export type MetaTemplateStatusUpdate = { wabaId: string; name: string; language: string; status: WhatsappTemplateStatus; receivedAt: number };

export function normalizeTemplateStatus(value: unknown): WhatsappTemplateStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized || undefined;
}
export function isTemplateApproved(status: WhatsappTemplateStatus | undefined): boolean { return status === "APPROVED"; }
export function initialTemplateStatus(value: unknown): WhatsappTemplateStatus { return normalizeTemplateStatus(value) ?? "PENDING"; }

type WhatsappTemplateState = Pick<StoreWhatsapp, "wabaId" | "templateName" | "templateLang" | "templateStatus" | "templateStatusUpdatedAt" | "templates">;

// Compatibilidade apenas de leitura: um documento legado só representa o
// template canônico de pós-venda e nunca recebe migração automática.
export function legacyPostSaleTemplate(whatsapp: WhatsappTemplateState | undefined): WhatsappCatalogTemplate | undefined {
  if (!whatsapp || whatsapp.templates) return undefined;
  const postSale = getCatalogTemplate("pos_venda_agradecimento");
  if (whatsapp.templateName !== postSale.name || whatsapp.templateLang !== postSale.language) return undefined;
  return {
    name: whatsapp.templateName,
    language: whatsapp.templateLang,
    status: whatsapp.templateStatus ?? "PENDING",
    ...(typeof whatsapp.templateStatusUpdatedAt === "number" ? { statusUpdatedAt: whatsapp.templateStatusUpdatedAt } : {}),
  };
}

export function storedCatalogTemplate(whatsapp: WhatsappTemplateState | undefined, key: TemplateCatalogKey): WhatsappCatalogTemplate | undefined {
  return whatsapp?.templates?.[key] ?? (key === "pos_venda_agradecimento" ? legacyPostSaleTemplate(whatsapp) : undefined);
}

export function catalogTemplateKeyForStoredIdentity(whatsapp: WhatsappTemplateState | undefined, name: string, language: string): TemplateCatalogKey | undefined {
  const catalog = findCatalogTemplateByIdentity(name, language);
  if (!catalog) return undefined;
  const stored = storedCatalogTemplate(whatsapp, catalog.key);
  return stored?.name === name && stored.language === language ? catalog.key : undefined;
}

export function assertCommercialTemplateApproved(params: { whatsapp: WhatsappTemplateState | undefined; key: TemplateCatalogKey }): WhatsappCatalogTemplate {
  const expected = getCatalogTemplate(params.key);
  const stored = storedCatalogTemplate(params.whatsapp, params.key);
  if (!stored || stored.name !== expected.name || stored.language !== expected.language || !isTemplateApproved(stored.status)) {
    throw new Error(TEMPLATE_NOT_APPROVED_ERROR);
  }
  return stored;
}

export function canApplyTemplateStatusUpdate(params: { storeActive: boolean; template: WhatsappCatalogTemplate | undefined; receivedAt: number }): boolean {
  return params.storeActive && !!params.template
    && (typeof params.template.statusUpdatedAt !== "number" || params.template.statusUpdatedAt < params.receivedAt);
}

function webhookTimeMs(value: unknown): number {
  const seconds = typeof value === "number" ? value : Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
}

export function parseMetaTemplateStatusUpdate(entry: unknown, change: unknown): MetaTemplateStatusUpdate | null {
  if (!entry || typeof entry !== "object" || !change || typeof change !== "object") return null;
  const currentEntry = entry as { id?: unknown; time?: unknown };
  const currentChange = change as { field?: unknown; value?: unknown };
  if (currentChange.field !== "message_template_status_update" || !currentChange.value || typeof currentChange.value !== "object") return null;
  const value = currentChange.value as { event?: unknown; message_template_name?: unknown; message_template_language?: unknown };
  const status = normalizeTemplateStatus(value.event);
  if (typeof currentEntry.id !== "string" || typeof value.message_template_name !== "string" || typeof value.message_template_language !== "string" || !status) return null;
  return { wabaId: currentEntry.id, name: value.message_template_name, language: value.message_template_language, status, receivedAt: webhookTimeMs(currentEntry.time) };
}

export function templateStatusLabel(status: WhatsappTemplateStatus | undefined): string {
  switch (status) {
    case "PENDING": return "Em análise";
    case "APPROVED": return "Aprovado";
    case "REJECTED": return "Rejeitado";
    case "PAUSED": return "Pausado";
    case "DISABLED": return "Desativado";
    default: return "Indisponível";
  }
}

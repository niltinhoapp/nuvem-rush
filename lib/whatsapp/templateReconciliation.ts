import { FieldValue } from "firebase-admin/firestore";
import { db, storeRef } from "@/lib/firebase/admin";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import {
  WHATSAPP_TEMPLATE_CATALOG_KEYS,
} from "./catalog";
import { createCatalogTemplate } from "./embedded";
import { storedCatalogTemplate } from "./templateStatus";
import type { TemplateCatalogKey } from "./catalog";
import type { Store, WhatsappCatalogTemplate } from "@/types";
import {
  fetchCanonicalTemplateSnapshot,
  provisionMissingShipmentTemplate,
  type CanonicalTemplateSnapshot,
} from "./templateReconciliationMeta";

export const WHATSAPP_TEMPLATE_RECONCILIATION_TTL_MS = 5 * 60 * 1000;

export type TemplateReconciliationResult = {
  attempted: boolean;
  metaAvailable: boolean;
  createdShipmentTemplate: boolean;
  snapshot?: CanonicalTemplateSnapshot;
  staleSnapshotIgnored?: TemplateCatalogKey[];
};

type ObservedTemplateState = Partial<Record<TemplateCatalogKey, WhatsappCatalogTemplate>>;

function captureTemplateState(whatsapp: Store["whatsapp"]): ObservedTemplateState {
  return Object.fromEntries(WHATSAPP_TEMPLATE_CATALOG_KEYS.map((key) => [
    key,
    storedCatalogTemplate(whatsapp, key),
  ])) as ObservedTemplateState;
}

function sameTemplateState(a: WhatsappCatalogTemplate | undefined, b: WhatsappCatalogTemplate | undefined): boolean {
  return a?.name === b?.name
    && a?.language === b?.language
    && a?.status === b?.status
    && a?.statusUpdatedAt === b?.statusUpdatedAt;
}

function sanitizedProviderError(error: unknown): { errorName: string } {
  return { errorName: error instanceof Error ? error.name : "unknown" };
}

async function persistSnapshot(params: {
  storeId: string;
  wabaId: string;
  snapshot: CanonicalTemplateSnapshot;
  observed: ObservedTemplateState;
  reconciledAt: number;
  shipmentProvision?: WhatsappCatalogTemplate | "failed";
  advanceTtl: boolean;
}): Promise<TemplateCatalogKey[]> {
  return db.runTransaction(async (tx) => {
    const ref = storeRef(params.storeId);
    const snap = await tx.get(ref);
    const store = snap.data() as Store | undefined;
    if (!store || !isStoreCommerciallyActive(store.status) || store.whatsapp?.wabaId !== params.wabaId) {
      throw new Error("store_or_waba_changed");
    }
    const updates: Record<string, unknown> = {};
    const staleSnapshotIgnored: TemplateCatalogKey[] = [];
    if (params.advanceTtl) {
      updates["whatsapp.templatesLastReconciledAt"] = Math.max(
        whatsappTimestamp(store.whatsapp?.templatesLastReconciledAt),
        params.reconciledAt,
      );
    }
    for (const key of WHATSAPP_TEMPLATE_CATALOG_KEYS) {
      const template = params.snapshot.found[key];
      if (!template) continue;
      const current = storedCatalogTemplate(store.whatsapp, key);
      if (!sameTemplateState(current, params.observed[key])) {
        staleSnapshotIgnored.push(key);
        continue;
      }
      updates[`whatsapp.templates.${key}`] = {
        ...template,
        statusUpdatedAt: Math.max(params.reconciledAt, whatsappTimestamp(current?.statusUpdatedAt) + 1),
      };
      updates[`whatsapp.templateProvisionFailures.${key}`] = FieldValue.delete();
    }
    if (params.shipmentProvision) {
      const key = "pedido_enviado_rastreio";
      const current = storedCatalogTemplate(store.whatsapp, key);
      if (!sameTemplateState(current, params.observed[key])) {
        if (!staleSnapshotIgnored.includes(key)) staleSnapshotIgnored.push(key);
      } else if (params.shipmentProvision !== "failed") {
        updates["whatsapp.templates.pedido_enviado_rastreio"] = {
          ...params.shipmentProvision,
          statusUpdatedAt: Math.max(params.reconciledAt, whatsappTimestamp(current?.statusUpdatedAt) + 1),
        };
        updates["whatsapp.templateProvisionFailures.pedido_enviado_rastreio"] = FieldValue.delete();
      } else {
        updates["whatsapp.templateProvisionFailures.pedido_enviado_rastreio"] = {
          failedAt: params.reconciledAt,
          reason: "provider_error",
        };
      }
    }
    if (Object.keys(updates).length) tx.update(ref, updates);
    return staleSnapshotIgnored;
  });
}

function whatsappTimestamp(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function reconcileStoreWhatsappTemplates(params: {
  storeId: string;
  force?: boolean;
  now?: number;
  fetchSnapshot?: typeof fetchCanonicalTemplateSnapshot;
  createShipment?: typeof createCatalogTemplate;
  beforePersist?: () => Promise<void>;
}): Promise<TemplateReconciliationResult> {
  const now = params.now ?? Date.now();
  const initial = (await storeRef(params.storeId).get()).data() as Store | undefined;
  const whatsapp = initial?.whatsapp;
  if (!initial || !isStoreCommerciallyActive(initial.status) || !whatsapp || whatsapp.status !== "connected") {
    return { attempted: false, metaAvailable: false, createdShipmentTemplate: false };
  }
  const observed = captureTemplateState(whatsapp);
  if (!params.force && typeof whatsapp.templatesLastReconciledAt === "number"
    && now - whatsapp.templatesLastReconciledAt < WHATSAPP_TEMPLATE_RECONCILIATION_TTL_MS) {
    return { attempted: false, metaAvailable: true, createdShipmentTemplate: false };
  }

  const fetchSnapshot = params.fetchSnapshot ?? fetchCanonicalTemplateSnapshot;
  let snapshot: CanonicalTemplateSnapshot;
  try {
    snapshot = await fetchSnapshot(whatsapp.wabaId, whatsapp.accessToken);
  } catch (error) {
    console.warn("[whatsapp templates] reconciliation lookup failed", {
      storeId: params.storeId,
      ...sanitizedProviderError(error),
    });
    return { attempted: true, metaAvailable: false, createdShipmentTemplate: false };
  }

  const shipment = await provisionMissingShipmentTemplate({
    wabaId: whatsapp.wabaId,
    accessToken: whatsapp.accessToken,
    snapshot,
    now,
    fetchSnapshot,
    createShipment: params.createShipment ?? createCatalogTemplate,
  });
  snapshot = shipment.snapshot;
  const shipmentProvision = shipment.provision;
  const createdShipmentTemplate = shipment.created;

  await params.beforePersist?.();
  const reconciledAt = params.now ?? Date.now();
  const staleSnapshotIgnored = await persistSnapshot({
    storeId: params.storeId,
    wabaId: whatsapp.wabaId,
    snapshot,
    observed,
    reconciledAt,
    shipmentProvision,
    // Um quarto template ainda incerto deve poder ser recuperado imediatamente.
    advanceTtl: shipmentProvision !== "failed",
  });
  if (staleSnapshotIgnored.length) {
    console.info("[whatsapp templates] stale snapshot ignored", {
      storeId: params.storeId,
      templateKeys: staleSnapshotIgnored,
    });
  }
  return { attempted: true, metaAvailable: true, createdShipmentTemplate, snapshot, staleSnapshotIgnored };
}

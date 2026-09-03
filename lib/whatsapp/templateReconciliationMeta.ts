import {
  WHATSAPP_TEMPLATE_CATALOG_KEYS,
  findCatalogTemplateByIdentity,
  getCatalogTemplate,
  type TemplateCatalogKey,
} from "./catalog";
import { createCatalogTemplate } from "./embedded";
import { normalizeTemplateStatus } from "./templateStatus";
import type { WhatsappCatalogTemplate } from "@/types";

const GRAPH = "https://graph.facebook.com/v22.0";
const ALLOWED_GRAPH_HOSTS = new Set(["graph.facebook.com"]);
export const MAX_TEMPLATE_PAGES = 20;

export type CanonicalTemplateSnapshot = {
  found: Partial<Record<TemplateCatalogKey, WhatsappCatalogTemplate>>;
  missing: TemplateCatalogKey[];
};

export async function fetchCanonicalTemplateSnapshot(
  wabaId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<CanonicalTemplateSnapshot> {
  let url = new URL(`${GRAPH}/${encodeURIComponent(wabaId)}/message_templates`);
  url.searchParams.set("fields", "name,language,status");
  url.searchParams.set("limit", "250");
  const found: CanonicalTemplateSnapshot["found"] = {};
  const visited = new Set<string>();

  for (let page = 1; page <= MAX_TEMPLATE_PAGES; page++) {
    // Tokens eventualmente incluídos pela Meta em paging.next são removidos;
    // todas as páginas usam exclusivamente o Authorization server-side.
    url.searchParams.delete("access_token");
    const identity = url.toString();
    if (visited.has(identity)) throw new Error("meta_template_pagination_loop");
    visited.add(identity);

    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = (await res.json().catch(() => ({}))) as {
      data?: unknown[];
      error?: { code?: number };
      paging?: { next?: unknown };
    };
    if (!res.ok || !Array.isArray(body.data)) {
      const error = new Error("meta_template_lookup_failed");
      error.name = typeof body.error?.code === "number" ? `MetaGraphError${body.error.code}` : "MetaGraphError";
      throw error;
    }
    for (const item of body.data) {
      if (!item || typeof item !== "object") continue;
      const value = item as { name?: unknown; language?: unknown; status?: unknown };
      if (typeof value.name !== "string" || typeof value.language !== "string") continue;
      const catalog = findCatalogTemplateByIdentity(value.name, value.language);
      const status = normalizeTemplateStatus(value.status);
      if (!catalog || !status) continue;
      found[catalog.key] = { name: catalog.name, language: catalog.language, status };
    }

    const next = body.paging?.next;
    if (next === undefined || next === null || next === "") break;
    if (typeof next !== "string") throw new Error("meta_template_invalid_paging_url");
    const candidate = new URL(next);
    if (candidate.protocol !== "https:" || !ALLOWED_GRAPH_HOSTS.has(candidate.hostname)) {
      throw new Error("meta_template_invalid_paging_url");
    }
    candidate.username = "";
    candidate.password = "";
    candidate.hash = "";
    candidate.searchParams.delete("access_token");
    if (page === MAX_TEMPLATE_PAGES) throw new Error("meta_template_page_limit_exceeded");
    url = candidate;
  }
  return { found, missing: WHATSAPP_TEMPLATE_CATALOG_KEYS.filter((key) => !found[key]) };
}

export async function provisionMissingShipmentTemplate(params: {
  wabaId: string;
  accessToken: string;
  snapshot: CanonicalTemplateSnapshot;
  now: number;
  fetchSnapshot: typeof fetchCanonicalTemplateSnapshot;
  createShipment: typeof createCatalogTemplate;
}): Promise<{ snapshot: CanonicalTemplateSnapshot; provision?: WhatsappCatalogTemplate | "failed"; created: boolean }> {
  if (!params.snapshot.missing.includes("pedido_enviado_rastreio")) return { snapshot: params.snapshot, created: false };
  const catalog = getCatalogTemplate("pedido_enviado_rastreio");
  try {
    const result = await params.createShipment(params.wabaId, params.accessToken, catalog);
    if (result.created) return {
      snapshot: params.snapshot,
      created: true,
      provision: { name: catalog.name, language: catalog.language, status: "PENDING", statusUpdatedAt: params.now },
    };
    if (result.alreadyExisted) return { snapshot: await params.fetchSnapshot(params.wabaId, params.accessToken), created: false };
    return { snapshot: params.snapshot, created: false, provision: "failed" };
  } catch (error) {
    console.warn("[whatsapp templates] shipment template provision failed", {
      templateKey: "pedido_enviado_rastreio",
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return { snapshot: params.snapshot, created: false, provision: "failed" };
  }
}

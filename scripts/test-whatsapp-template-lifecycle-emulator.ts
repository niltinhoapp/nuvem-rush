import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { WHATSAPP_TEMPLATE_CATALOG_KEYS, getCatalogTemplate, type TemplateCatalogKey } from "../lib/whatsapp/catalog";
import { parseMetaTemplateStatusUpdate } from "../lib/whatsapp/templateStatus";
import type { CatalogTemplateProvision, CatalogTemplateProvisionOutcome } from "../lib/whatsapp/embedded";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-whatsapp-template" });

const key = (value: TemplateCatalogKey) => getCatalogTemplate(value);
function templates(status = "PENDING", updatedAt = 0) {
  return Object.fromEntries(WHATSAPP_TEMPLATE_CATALOG_KEYS.map((templateKey) => [templateKey, {
    name: key(templateKey).name, language: key(templateKey).language, status, statusUpdatedAt: updatedAt,
  }]));
}
function provision(overrides: Partial<Record<TemplateCatalogKey, CatalogTemplateProvisionOutcome>>): CatalogTemplateProvision {
  return Object.fromEntries(WHATSAPP_TEMPLATE_CATALOG_KEYS.map((templateKey) => [
    templateKey,
    overrides[templateKey] ?? { outcome: "unconfirmed" },
  ])) as CatalogTemplateProvision;
}
function event(wabaId: string, status: string, seconds: number, templateKey: TemplateCatalogKey, language = "pt_BR") {
  const parsed = parseMetaTemplateStatusUpdate({ id: wabaId, time: seconds }, {
    field: "message_template_status_update",
    value: { event: status, message_template_name: key(templateKey).name, message_template_language: language },
  });
  assert.ok(parsed);
  return parsed;
}

async function main() {
  const db = getFirestore();
  // O repositório inicializa o Admin SDK de produção quando não há app. A app
  // demo precisa existir antes do import para o teste nunca tocar credenciais.
  const { updateTemplateStatus } = await import("../lib/whatsapp/templateStatus.firestore");
  const { persistWhatsappConnection } = await import("../lib/whatsapp/connectPersistence");
  const { reconcileStoreWhatsappTemplates } = await import("../lib/whatsapp/templateReconciliation");
  const stores = ["ambiguous-a", "ambiguous-b", "tenant-a", "tenant-b", "stale-a", "parallel-a", "duplicate-a", "legacy-a", "inactive-a", "reconnect-p1", "reconnect-legacy", "reconnect-empty", "reconcile-a", "reconcile-failure", "reconcile-missing", "race-webhook", "race-reconcile", "later-status", "monotonic-at", "ttl-provision-failure"];
  for (const id of stores) await db.recursiveDelete(db.doc(`stores/${id}`));
  async function seed(id: string, wabaId: string, options: { status?: string; legacy?: boolean; updatedAt?: number } = {}) {
    const post = key("pos_venda_agradecimento");
    await db.doc(`stores/${id}`).set({
      status: options.status ?? "active",
      whatsapp: options.legacy ? {
        wabaId, phoneNumberId: `phone-${id}`, accessToken: "fixture", status: "connected",
        templateName: post.name, templateLang: post.language, templateStatus: "PENDING", templateStatusUpdatedAt: options.updatedAt ?? 0,
      } : {
        wabaId, phoneNumberId: `phone-${id}`, accessToken: "fixture", status: "connected",
        templates: templates("PENDING", options.updatedAt ?? 0),
      },
    });
  }
  async function whatsapp(id: string) { return (await db.doc(`stores/${id}`).get()).data()?.whatsapp; }

  // 1/10: duas stores com a mesma WABA falham fechadas.
  await seed("ambiguous-a", "waba-same"); await seed("ambiguous-b", "waba-same");
  assert.equal(await updateTemplateStatus(event("waba-same", "APPROVED", 200, "pedido_pagamento_confirmado")), "ignored_missing_or_ambiguous_waba");
  assert.equal((await whatsapp("ambiguous-a")).templates.pedido_pagamento_confirmado.status, "PENDING");

  // 2/10: WABA A não altera WABA B.
  await seed("tenant-a", "waba-a"); await seed("tenant-b", "waba-b");
  assert.equal(await updateTemplateStatus(event("waba-a", "APPROVED", 200, "pedido_pagamento_confirmado")), "updated");
  assert.equal((await whatsapp("tenant-a")).templates.pedido_pagamento_confirmado.status, "APPROVED");
  assert.equal((await whatsapp("tenant-b")).templates.pedido_pagamento_confirmado.status, "PENDING");

  // 3/10: nome e idioma estranhos não encontram chave persistida.
  assert.equal(await updateTemplateStatus(event("waba-a", "PENDING", 300, "carrinho_abandonado")), "updated");
  assert.equal(await updateTemplateStatus(event("waba-a", "APPROVED", 400, "carrinho_abandonado", "en_US")), "ignored_store_or_template_mismatch");

  // 4/10: status é independente por template e timestamp oficial é segundos -> ms.
  assert.equal((await whatsapp("tenant-a")).templates.pedido_pagamento_confirmado.statusUpdatedAt, 200_000);
  assert.equal((await whatsapp("tenant-a")).templates.carrinho_abandonado.status, "PENDING");

  // 5/10: stale concorrente no mesmo template não regride.
  await seed("stale-a", "waba-stale");
  await Promise.all([
    updateTemplateStatus(event("waba-stale", "APPROVED", 200, "pedido_enviado_rastreio")),
    updateTemplateStatus(event("waba-stale", "PENDING", 100, "pedido_enviado_rastreio")),
  ]);
  assert.equal((await whatsapp("stale-a")).templates.pedido_enviado_rastreio.status, "APPROVED");

  // 6/10: atualizações concorrentes em chaves distintas convergem ambas.
  await seed("parallel-a", "waba-parallel");
  await Promise.all([
    updateTemplateStatus(event("waba-parallel", "APPROVED", 200, "carrinho_abandonado")),
    updateTemplateStatus(event("waba-parallel", "REJECTED", 200, "pedido_pagamento_confirmado")),
  ]);
  const parallel = await whatsapp("parallel-a");
  assert.equal(parallel.templates.carrinho_abandonado.status, "APPROVED");
  assert.equal(parallel.templates.pedido_pagamento_confirmado.status, "REJECTED");

  // 7/10: duplicata é no-op.
  await seed("duplicate-a", "waba-duplicate");
  const duplicate = event("waba-duplicate", "APPROVED", 200, "pos_venda_agradecimento");
  assert.equal(await updateTemplateStatus(duplicate), "updated");
  assert.equal(await updateTemplateStatus(duplicate), "ignored_store_or_template_mismatch");

  // 8/10: legado atualiza apenas o campo legado de pós-venda, sem migração.
  await seed("legacy-a", "waba-legacy", { legacy: true });
  assert.equal(await updateTemplateStatus(event("waba-legacy", "APPROVED", 200, "pos_venda_agradecimento")), "updated");
  const legacy = await whatsapp("legacy-a");
  assert.equal(legacy.templateStatus, "APPROVED"); assert.equal(legacy.templates, undefined);

  // 9/10: store inativa e WABA ausente não são mutadas.
  await seed("inactive-a", "waba-inactive", { status: "uninstalled" });
  assert.equal(await updateTemplateStatus(event("waba-inactive", "APPROVED", 200, "pedido_pagamento_confirmado")), "ignored_store_or_template_mismatch");
  assert.equal(await updateTemplateStatus(event("missing", "APPROVED", 200, "pedido_pagamento_confirmado")), "ignored_missing_or_ambiguous_waba");

  // 10/10: reconnect é transacional e não deixa uma falha de observação
  // degradar APPROVED. Estados confirmados atuais, inclusive PENDING e
  // REJECTED, são a única autoridade para substituir o estado persistido.
  await seed("reconnect-p1", "waba-reconnect");
  await db.doc("stores/reconnect-p1").update({
    "whatsapp.templates.pedido_enviado_rastreio.status": "APPROVED",
    "whatsapp.templates.pos_venda_agradecimento.status": "APPROVED",
    "whatsapp.templates.unrelated": { marker: "keep" },
    "whatsapp.lastRefreshError": "keep",
    "whatsapp.lastRefreshAttempt": 7,
    "whatsapp.refreshFailCount": 3,
  });
  await persistWhatsappConnection({
    storeId: "reconnect-p1", wabaId: "waba-reconnect", phoneNumberId: "phone-new", accessToken: "token-new", now: 500,
    provision: provision({
      carrinho_abandonado: { outcome: "existing_status_confirmed", template: { ...key("carrinho_abandonado"), status: "PENDING", statusUpdatedAt: 500 } },
      pedido_pagamento_confirmado: { outcome: "existing_status_confirmed", template: { ...key("pedido_pagamento_confirmado"), status: "REJECTED", statusUpdatedAt: 500 } },
      pedido_enviado_rastreio: { outcome: "unconfirmed" },
      pos_venda_agradecimento: { outcome: "existing_status_confirmed", template: { ...key("pos_venda_agradecimento"), status: "APPROVED", statusUpdatedAt: 500 } },
    }),
  });
  const reconnectP1 = await whatsapp("reconnect-p1");
  assert.equal(reconnectP1.templates.pedido_enviado_rastreio.status, "APPROVED");
  assert.equal(reconnectP1.templates.carrinho_abandonado.status, "PENDING");
  assert.equal(reconnectP1.templates.pedido_pagamento_confirmado.status, "REJECTED");
  assert.equal(reconnectP1.templates.pos_venda_agradecimento.status, "APPROVED");
  assert.equal(reconnectP1.templates.unrelated.marker, "keep");
  assert.equal(reconnectP1.lastRefreshError, "keep");
  assert.equal(reconnectP1.lastRefreshAttempt, 7);
  assert.equal(reconnectP1.refreshFailCount, 3);

  // Documento sem template e falha no provisionamento fica sem template.
  await db.doc("stores/reconnect-empty").set({
    status: "active",
    whatsapp: { wabaId: "waba-empty", phoneNumberId: "phone", accessToken: "fixture", status: "connected", connectedAt: 1 },
  });
  await persistWhatsappConnection({
    storeId: "reconnect-empty", wabaId: "waba-empty", phoneNumberId: "phone", accessToken: "token", now: 600,
    provision: provision({}),
  });
  assert.equal((await whatsapp("reconnect-empty")).templates, undefined);

  // Legado não é migrado e seus campos continuam íntegros durante reconnect.
  await seed("reconnect-legacy", "waba-legacy-reconnect", { legacy: true });
  await persistWhatsappConnection({
    storeId: "reconnect-legacy", wabaId: "waba-legacy-reconnect", phoneNumberId: "phone", accessToken: "token", now: 700,
    provision: provision({ pos_venda_agradecimento: { outcome: "existing_status_confirmed", template: { ...key("pos_venda_agradecimento"), status: "APPROVED", statusUpdatedAt: 700 } } }),
  });
  const reconnectLegacy = await whatsapp("reconnect-legacy");
  assert.equal(reconnectLegacy.templates, undefined);
  assert.equal(reconnectLegacy.templateName, key("pos_venda_agradecimento").name);
  assert.equal(reconnectLegacy.templateLang, "pt_BR");
  assert.equal(reconnectLegacy.templateStatus, "PENDING");

  // 11/13: webhook perdido converge pelo snapshot confirmado da Meta.
  await seed("reconcile-a", "waba-reconcile");
  const allApproved = { found: templates("APPROVED", 0), missing: [] };
  await reconcileStoreWhatsappTemplates({
    storeId: "reconcile-a", force: true, now: 800,
    fetchSnapshot: async () => allApproved,
    createShipment: async () => { throw new Error("must_not_create"); },
  });
  assert.equal((await whatsapp("reconcile-a")).templates.carrinho_abandonado.status, "APPROVED");

  // 12/13: indisponibilidade da Meta mantém integralmente o último estado.
  await seed("reconcile-failure", "waba-reconcile-failure");
  await db.doc("stores/reconcile-failure").update({ "whatsapp.templates.pos_venda_agradecimento.status": "APPROVED" });
  const unavailable = await reconcileStoreWhatsappTemplates({
    storeId: "reconcile-failure", force: true, now: 900,
    fetchSnapshot: async () => { throw new Error("temporary"); },
  });
  assert.equal(unavailable.metaAvailable, false);
  assert.equal((await whatsapp("reconcile-failure")).templates.pos_venda_agradecimento.status, "APPROVED");

  // 13/13: uma ausência confirmada não remove nem altera as outras chaves.
  await seed("reconcile-missing", "waba-reconcile-missing");
  const partialSnapshot = {
    found: {
      pedido_pagamento_confirmado: { ...key("pedido_pagamento_confirmado"), status: "APPROVED" },
      pedido_enviado_rastreio: { ...key("pedido_enviado_rastreio"), status: "APPROVED" },
      pos_venda_agradecimento: { ...key("pos_venda_agradecimento"), status: "APPROVED" },
    },
    missing: ["carrinho_abandonado" as const],
  };
  await reconcileStoreWhatsappTemplates({
    storeId: "reconcile-missing", force: true, now: 1_000,
    fetchSnapshot: async () => partialSnapshot,
    createShipment: async () => { throw new Error("must_not_create"); },
  });
  const reconciledMissing = await whatsapp("reconcile-missing");
  assert.equal(reconciledMissing.templates.carrinho_abandonado.status, "PENDING");
  assert.equal(reconciledMissing.templates.pedido_pagamento_confirmado.status, "APPROVED");

  // 14/18: webhook ocorrido durante a chamada externa vence snapshot stale.
  await seed("race-webhook", "waba-race-webhook");
  const raceWebhook = await reconcileStoreWhatsappTemplates({
    storeId: "race-webhook", force: true, now: 1_000,
    fetchSnapshot: async () => ({ found: templates("PENDING", 0), missing: [] }),
    createShipment: async () => { throw new Error("must_not_create"); },
    beforePersist: async () => {
      assert.equal(await updateTemplateStatus(event("waba-race-webhook", "APPROVED", 2, "pedido_pagamento_confirmado")), "updated");
    },
  });
  assert.ok(raceWebhook.staleSnapshotIgnored?.includes("pedido_pagamento_confirmado"));
  assert.equal((await whatsapp("race-webhook")).templates.pedido_pagamento_confirmado.status, "APPROVED");

  // 15/18: resposta antiga que termina depois não sobrescreve reconciliação nova.
  await seed("race-reconcile", "waba-race-reconcile");
  let releaseOlder!: () => void;
  let olderReady!: () => void;
  const olderGate = new Promise<void>((resolve) => { releaseOlder = resolve; });
  const ready = new Promise<void>((resolve) => { olderReady = resolve; });
  const older = reconcileStoreWhatsappTemplates({
    storeId: "race-reconcile", force: true, now: 3_000,
    fetchSnapshot: async () => ({ found: templates("PENDING", 0), missing: [] }),
    createShipment: async () => { throw new Error("must_not_create"); },
    beforePersist: async () => { olderReady(); await olderGate; },
  });
  await ready;
  await reconcileStoreWhatsappTemplates({
    storeId: "race-reconcile", force: true, now: 4_000,
    fetchSnapshot: async () => ({ found: templates("APPROVED", 0), missing: [] }),
    createShipment: async () => { throw new Error("must_not_create"); },
  });
  releaseOlder();
  const olderResult = await older;
  assert.ok(olderResult.staleSnapshotIgnored?.includes("pedido_pagamento_confirmado"));
  assert.equal((await whatsapp("race-reconcile")).templates.pedido_pagamento_confirmado.status, "APPROVED");

  // 16/18: APPROVED pode mudar legitimamente para PAUSED/DISABLED quando novo.
  await seed("later-status", "waba-later-status");
  await db.doc("stores/later-status").update({ "whatsapp.templates.pedido_enviado_rastreio.status": "APPROVED" });
  assert.equal(await updateTemplateStatus(event("waba-later-status", "PAUSED", 5, "pedido_enviado_rastreio")), "updated");
  assert.equal((await whatsapp("later-status")).templates.pedido_enviado_rastreio.status, "PAUSED");
  assert.equal(await updateTemplateStatus(event("waba-later-status", "DISABLED", 6, "pedido_enviado_rastreio")), "updated");
  assert.equal((await whatsapp("later-status")).templates.pedido_enviado_rastreio.status, "DISABLED");

  // 17/18: reconciliação nunca reduz statusUpdatedAt, mesmo com relógio menor.
  await seed("monotonic-at", "waba-monotonic-at", { updatedAt: 10_000 });
  await reconcileStoreWhatsappTemplates({
    storeId: "monotonic-at", force: true, now: 1_000,
    fetchSnapshot: async () => ({ found: templates("REJECTED", 0), missing: [] }),
    createShipment: async () => { throw new Error("must_not_create"); },
  });
  assert.equal((await whatsapp("monotonic-at")).templates.carrinho_abandonado.statusUpdatedAt, 10_001);

  // 18/18: falha ao criar o quarto não avança TTL, mas persiste os outros três.
  await seed("ttl-provision-failure", "waba-ttl-provision-failure");
  const withoutShipment = {
    found: {
      carrinho_abandonado: { ...key("carrinho_abandonado"), status: "APPROVED" },
      pedido_pagamento_confirmado: { ...key("pedido_pagamento_confirmado"), status: "APPROVED" },
      pos_venda_agradecimento: { ...key("pos_venda_agradecimento"), status: "APPROVED" },
    },
    missing: ["pedido_enviado_rastreio" as const],
  };
  await reconcileStoreWhatsappTemplates({
    storeId: "ttl-provision-failure", force: true, now: 11_000,
    fetchSnapshot: async () => withoutShipment,
    createShipment: async () => { throw new Error("temporary"); },
  });
  const ttlFailure = await whatsapp("ttl-provision-failure");
  assert.equal(ttlFailure.templates.carrinho_abandonado.status, "APPROVED");
  assert.equal(ttlFailure.templates.pedido_enviado_rastreio.status, "PENDING");
  assert.equal(ttlFailure.templateProvisionFailures.pedido_enviado_rastreio.reason, "provider_error");
  assert.equal(ttlFailure.templatesLastReconciledAt, undefined);
  console.log("WhatsApp multi-template Firestore Emulator: 18/18 OK");
}

main().catch((error: unknown) => {
  console.error("WhatsApp multi-template Emulator failed", { name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : "unknown" });
  process.exitCode = 1;
});

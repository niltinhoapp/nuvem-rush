import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { WHATSAPP_TEMPLATE_CATALOG_KEYS, getCatalogTemplate, type TemplateCatalogKey } from "../lib/whatsapp/catalog";
import { parseMetaTemplateStatusUpdate } from "../lib/whatsapp/templateStatus";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-whatsapp-template" });

const key = (value: TemplateCatalogKey) => getCatalogTemplate(value);
function templates(status = "PENDING", updatedAt = 0) {
  return Object.fromEntries(WHATSAPP_TEMPLATE_CATALOG_KEYS.map((templateKey) => [templateKey, {
    name: key(templateKey).name, language: key(templateKey).language, status, statusUpdatedAt: updatedAt,
  }]));
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
  const stores = ["ambiguous-a", "ambiguous-b", "tenant-a", "tenant-b", "stale-a", "parallel-a", "duplicate-a", "legacy-a", "inactive-a"];
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

  // 9/10: store inativa não é mutada.
  await seed("inactive-a", "waba-inactive", { status: "uninstalled" });
  assert.equal(await updateTemplateStatus(event("waba-inactive", "APPROVED", 200, "pedido_pagamento_confirmado")), "ignored_store_or_template_mismatch");

  // 10/10: WABA ausente é ignorada sem escrita.
  assert.equal(await updateTemplateStatus(event("missing", "APPROVED", 200, "pedido_pagamento_confirmado")), "ignored_missing_or_ambiguous_waba");
  console.log("WhatsApp multi-template Firestore Emulator: 10/10 OK");
}

main().catch((error: unknown) => {
  console.error("WhatsApp multi-template Emulator failed", { name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : "unknown" });
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WHATSAPP_TEMPLATE_CATALOG,
  WHATSAPP_TEMPLATE_CATALOG_KEYS,
  catalogTemplateForEvent,
  getCatalogTemplate,
} from "../lib/whatsapp/catalog";
import { provisionCatalogTemplates } from "../lib/whatsapp/embedded";
import { mergeConfirmedCatalogTemplates } from "../lib/whatsapp/connectMerge";
import {
  TEMPLATE_NOT_APPROVED_ERROR,
  assertCommercialTemplateApproved,
  canApplyTemplateStatusUpdate,
  legacyPostSaleTemplate,
  parseMetaTemplateStatusUpdate,
  templateStatusLabel,
} from "../lib/whatsapp/templateStatus";
import {
  TEMPLATE_INPUT_MISSING_ERROR,
  buildCatalogTemplateParameters,
  resolveCommercialTemplateKey,
} from "../lib/whatsapp/templateRouting";
import { sendApprovedCatalogTemplate } from "../lib/whatsapp/templateProvider";
import { isTransient } from "../lib/dispatch/retry";
import type { TemplateCatalogKey } from "../lib/whatsapp/catalog";
import type { WhatsappCatalogTemplate } from "../types";
import type { CatalogTemplateProvision } from "../lib/whatsapp/embedded";
import {
  fetchCanonicalTemplateSnapshot,
  provisionMissingShipmentTemplate,
} from "../lib/whatsapp/templateReconciliationMeta";
import { whatsappStatusPayload } from "../lib/whatsapp/templateStatusView";

const keys = ["carrinho_abandonado", "pedido_pagamento_confirmado", "pedido_enviado_rastreio", "pos_venda_agradecimento"] as const;
const approved = Object.fromEntries(keys.map((key) => [key, {
  name: getCatalogTemplate(key).name, language: "pt_BR", status: "APPROVED", statusUpdatedAt: 100,
}])) as Partial<Record<TemplateCatalogKey, WhatsappCatalogTemplate>>;
const approvedPaid = approved.pedido_pagamento_confirmado!;
const entry = { id: "waba-a", time: 200 };
const change = (event: string, name = "pedido_pagamento_confirmado", language = "pt_BR") => ({
  field: "message_template_status_update",
  value: { event, message_template_name: name, message_template_language: language },
});

function provision(overrides: Partial<CatalogTemplateProvision>): CatalogTemplateProvision {
  return Object.fromEntries(keys.map((key) => [key, overrides[key] ?? { outcome: "unconfirmed" }])) as CatalogTemplateProvision;
}

async function main() {
  // A / AE / AF: catálogo canônico, com classificação e cópia exata.
  assert.deepEqual(WHATSAPP_TEMPLATE_CATALOG_KEYS, keys);
  assert.equal(WHATSAPP_TEMPLATE_CATALOG.carrinho_abandonado.category, "MARKETING");
  assert.match(WHATSAPP_TEMPLATE_CATALOG.carrinho_abandonado.body, /responda SAIR/);
  for (const key of keys.slice(1)) assert.equal(getCatalogTemplate(key).category, "UTILITY");
  assert.equal(WHATSAPP_TEMPLATE_CATALOG.pedido_pagamento_confirmado.body, "Olá {{1}}! O pagamento do seu pedido {{2}} foi confirmado.");
  assert.equal(WHATSAPP_TEMPLATE_CATALOG.pos_venda_agradecimento.body, "Olá {{1}}! Obrigado pela sua compra.\nEsperamos que tenha uma ótima experiência com seu pedido.");
  for (const key of keys.slice(1)) assert.doesNotMatch(getCatalogTemplate(key).body, /promoção|cupom|upsell|cross-sell/i);
  assert.equal(catalogTemplateForEvent("order_created"), undefined);
  assert.match(WHATSAPP_TEMPLATE_CATALOG.pedido_pagamento_confirmado.body, /\{\{2\}\}/);
  assert.match(WHATSAPP_TEMPLATE_CATALOG.pedido_enviado_rastreio.body, /\{\{3\}\}/);

  // B-F: provisionamento independente, sequencial e fail-closed.
  const calls: string[] = [];
  const created = await provisionCatalogTemplates("waba", "token", {
    create: async (_waba, _token, template) => { calls.push(`create:${template.key}`); return { created: true, alreadyExisted: false }; },
    lookup: async () => { throw new Error("not called"); },
  });
  assert.deepEqual(calls, keys.map((key) => `create:${key}`));
  assert.deepEqual(Object.keys(created), keys);
  assert.ok(Object.values(created).every((result) => result.outcome === "created" && result.template?.status === "PENDING"));
  const partial = await provisionCatalogTemplates("waba", "token", {
    create: async (_waba, _token, template) => {
      if (template.key === "pedido_pagamento_confirmado") throw new Error("expected");
      return { created: true, alreadyExisted: false };
    },
    lookup: async () => "APPROVED",
  });
  assert.equal(partial.pedido_pagamento_confirmado.outcome, "unconfirmed");
  const reconnect = await provisionCatalogTemplates("waba", "token", {
    create: async () => ({ created: false, alreadyExisted: true }),
    lookup: async (_waba, _token, template) => template.key === "pedido_enviado_rastreio" ? "APPROVED" : "REJECTED",
  });
  assert.equal(reconnect.pedido_enviado_rastreio.template?.status, "APPROVED");
  assert.equal(reconnect.pedido_enviado_rastreio.outcome, "existing_status_confirmed");
  assert.equal(reconnect.carrinho_abandonado.template?.status, "REJECTED");
  const lookupFailure = await provisionCatalogTemplates("waba", "token", {
    create: async () => ({ created: false, alreadyExisted: true }),
    lookup: async () => { throw new Error("lookup failed"); },
  });
  assert.ok(Object.values(lookupFailure).every((result) => result.outcome === "unconfirmed" && !result.template));

  // Reconexão P1: falha de create/lookup não altera estado previamente
  // confirmado; somente uma leitura atual confirmada pode substituí-lo.
  const persisted = {
    ...approved,
    pedido_enviado_rastreio: { ...approved.pedido_enviado_rastreio!, status: "APPROVED" as const },
  };
  const lookupFailed = mergeConfirmedCatalogTemplates({ existing: persisted, provision: provision({
    carrinho_abandonado: { outcome: "existing_status_confirmed", template: { ...approved.carrinho_abandonado!, status: "PENDING" } },
    pedido_pagamento_confirmado: { outcome: "existing_status_confirmed", template: { ...approved.pedido_pagamento_confirmado!, status: "REJECTED" } },
    pedido_enviado_rastreio: { outcome: "unconfirmed" },
  }) });
  // A/B/F/I: falhas por já-existente+lookup e por criação não degradam o
  // APPROVED; as demais chaves confirmadas convergem independentemente.
  assert.equal(lookupFailed.pedido_enviado_rastreio?.status, "APPROVED");
  assert.equal(lookupFailed.carrinho_abandonado?.status, "PENDING");
  assert.equal(lookupFailed.pedido_pagamento_confirmado?.status, "REJECTED");
  // C/D: REJECTED e PENDING atuais, quando confirmados, substituem APPROVED.
  const confirmedReplacement = mergeConfirmedCatalogTemplates({ existing: approved, provision: provision({
    carrinho_abandonado: { outcome: "existing_status_confirmed", template: { ...approved.carrinho_abandonado!, status: "REJECTED" } },
    pedido_pagamento_confirmado: { outcome: "existing_status_confirmed", template: { ...approved.pedido_pagamento_confirmado!, status: "PENDING" } },
  }) });
  assert.equal(confirmedReplacement.carrinho_abandonado?.status, "REJECTED");
  assert.equal(confirmedReplacement.pedido_pagamento_confirmado?.status, "PENDING");
  // E/G: uma chave sem estado anterior fica ausente e chaves fora do catálogo
  // não são descartadas por uma falha de outra chave.
  const absent = mergeConfirmedCatalogTemplates({ existing: {}, provision: provision({ pos_venda_agradecimento: { outcome: "unconfirmed" } }) });
  assert.equal(absent.pos_venda_agradecimento, undefined);

  // G-H: shim legado é somente de leitura e limitado ao pós-venda canônico.
  const legacy = legacyPostSaleTemplate({ wabaId: "w", templateName: "pos_venda_agradecimento", templateLang: "pt_BR", templateStatus: "APPROVED" });
  assert.equal(legacy?.status, "APPROVED");
  assert.equal(legacyPostSaleTemplate({ wabaId: "w", templateName: "other", templateLang: "pt_BR" }), undefined);
  assert.equal(legacyPostSaleTemplate({ wabaId: "w", templates: {}, templateName: "pos_venda_agradecimento", templateLang: "pt_BR" }), undefined);

  // I-O: webhook reconhece somente nome+idioma guardado e é monotônico por chave.
  const parsed = parseMetaTemplateStatusUpdate(entry, change("APPROVED"));
  assert.equal(parsed?.receivedAt, 200_000);
  assert.equal(canApplyTemplateStatusUpdate({ storeActive: true, template: approvedPaid, receivedAt: 100 }), false);
  assert.equal(canApplyTemplateStatusUpdate({ storeActive: true, template: approvedPaid, receivedAt: 101 }), true);
  assert.equal(canApplyTemplateStatusUpdate({ storeActive: false, template: approvedPaid, receivedAt: 101 }), false);

  // P-S: seleção por evento fechada; pós-venda não é automático.
  assert.equal(resolveCommercialTemplateKey("cart_abandoned", undefined), "carrinho_abandonado");
  assert.equal(resolveCommercialTemplateKey("order_paid", undefined), "pedido_pagamento_confirmado");
  assert.equal(resolveCommercialTemplateKey("order_fulfilled", undefined), "pedido_enviado_rastreio");
  assert.equal(resolveCommercialTemplateKey("order_created", { whatsappTemplateKey: "pos_venda_agradecimento" }), "pos_venda_agradecimento");
  assert.throws(() => resolveCommercialTemplateKey("order_created", undefined), new RegExp(TEMPLATE_NOT_APPROVED_ERROR));
  assert.throws(() => resolveCommercialTemplateKey("order_paid", { whatsappTemplateKey: "pos_venda_agradecimento" }), new RegExp(TEMPLATE_NOT_APPROVED_ERROR));

  // T-Z: estados bloqueados não podem chamar o provider; apenas a chave
  // correta APPROVED é liberada.
  assert.doesNotThrow(() => assertCommercialTemplateApproved({ whatsapp: { wabaId: "w", templates: approved }, key: "pedido_pagamento_confirmado" }));
  let providerCalls = 0;
  const provider = async () => { providerCalls += 1; return new Response("", { status: 200 }); };
  for (const status of ["PENDING", "REJECTED", "PAUSED", "DISABLED", "UNKNOWN", undefined]) {
    assert.throws(() => assertCommercialTemplateApproved({ whatsapp: { wabaId: "w", templates: { ...approved, pedido_pagamento_confirmado: { ...approvedPaid, status: status ?? "PENDING" } } }, key: "pedido_pagamento_confirmado" }), new RegExp(TEMPLATE_NOT_APPROVED_ERROR));
    await assert.rejects(sendApprovedCatalogTemplate({
      whatsapp: { wabaId: "w", phoneNumberId: "phone", accessToken: "token", status: "connected", connectedAt: 1, templates: { ...approved, pedido_pagamento_confirmado: { ...approvedPaid, status: status ?? "PENDING" } } },
      key: "pedido_pagamento_confirmado", phoneNumberId: "phone", accessToken: "token", to: "11999999999", bodyParams: ["Ana", "123"], fetchFn: provider,
    }), new RegExp(TEMPLATE_NOT_APPROVED_ERROR));
  }
  assert.equal(providerCalls, 0);
  await sendApprovedCatalogTemplate({
    whatsapp: { wabaId: "w", phoneNumberId: "phone", accessToken: "token", status: "connected", connectedAt: 1, templates: approved },
    key: "pedido_pagamento_confirmado", phoneNumberId: "phone", accessToken: "token", to: "11999999999", bodyParams: ["Ana", "123"], fetchFn: provider,
  });
  assert.equal(providerCalls, 1);

  // AC: parâmetros definidos somente pelo catálogo.
  assert.deepEqual(buildCatalogTemplateParameters("carrinho_abandonado", { name: "Ana", recoveryUrl: "https://cart" }), ["Ana", "https://cart"]);
  assert.deepEqual(buildCatalogTemplateParameters("pedido_pagamento_confirmado", { name: "Ana", orderNumber: "123" }), ["Ana", "123"]);
  assert.deepEqual(buildCatalogTemplateParameters("pedido_enviado_rastreio", { name: "Ana", orderNumber: "123", trackingUrl: "https://track" }), ["Ana", "123", "https://track"]);
  assert.deepEqual(buildCatalogTemplateParameters("pos_venda_agradecimento", { name: "Ana" }), ["Ana"]);
  assert.throws(() => buildCatalogTemplateParameters("carrinho_abandonado", { name: "Ana" }), new RegExp(TEMPLATE_INPUT_MISSING_ERROR));
  assert.throws(() => buildCatalogTemplateParameters("pedido_enviado_rastreio", { name: "Ana", orderNumber: "123" }), new RegExp(TEMPLATE_INPUT_MISSING_ERROR));
  assert.equal(isTransient(new Error(TEMPLATE_NOT_APPROVED_ERROR)), false);
  assert.equal(isTransient(new Error(`${TEMPLATE_INPUT_MISSING_ERROR}:tracking_url`)), false);

  // AD: UI lista o catálogo e não existe configuração livre no canal.
  const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  const channel = readFileSync(new URL("../lib/channels/whatsapp.ts", import.meta.url), "utf8");
  const providerSource = readFileSync(new URL("../lib/whatsapp/templateProvider.ts", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../lib/whatsapp/templateStatus.firestore.ts", import.meta.url), "utf8");
  assert.match(dashboard, /WHATSAPP_TEMPLATE_CATALOG_KEYS/);
  assert.match(channel, /resolveCommercialTemplateKey/);
  assert.doesNotMatch(channel, /generateWhatsappContent/);
  assert.match(channel, /sendApprovedCatalogTemplate/);
  assert.ok(providerSource.indexOf("assertCommercialTemplateApproved") < providerSource.indexOf("graph.facebook.com"));
  assert.match(repository, /whatsapp\.templates/);
  assert.match(repository, /!whatsapp\.templates/);
  assert.equal(templateStatusLabel("APPROVED"), "Aprovado");

  // Reconciliação: somente identidades canônicas exatas entram no snapshot.
  const metaSnapshot = await fetchCanonicalTemplateSnapshot("waba", "secret", async () => new Response(JSON.stringify({ data: [
    { name: "carrinho_abandonado", language: "pt_BR", status: "approved" },
    { name: "pedido_pagamento_confirmado", language: "en_US", status: "APPROVED" },
    { name: "estranho", language: "pt_BR", status: "APPROVED" },
  ] }), { status: 200 }));
  assert.equal(metaSnapshot.found.carrinho_abandonado?.status, "APPROVED");
  assert.equal(metaSnapshot.found.pedido_pagamento_confirmado, undefined);
  assert.ok(metaSnapshot.missing.includes("pedido_enviado_rastreio"));

  // Paginação completa encontra templates canônicos em páginas posteriores,
  // inclusive depois de mais de 250 registros.
  let pageCalls = 0;
  const fillers = Array.from({ length: 250 }, (_, index) => ({
    name: `nao_canonico_${index}`, language: "pt_BR", status: "APPROVED",
  }));
  const pagedSnapshot = await fetchCanonicalTemplateSnapshot("waba", "secret", async () => {
    pageCalls++;
    return pageCalls === 1
      ? new Response(JSON.stringify({ data: fillers, paging: { next: "https://graph.facebook.com/v22.0/waba/message_templates?after=250&access_token=leak" } }), { status: 200 })
      : new Response(JSON.stringify({ data: [{ name: "pedido_enviado_rastreio", language: "pt_BR", status: "APPROVED" }] }), { status: 200 });
  });
  assert.equal(pageCalls, 2);
  assert.equal(pagedSnapshot.found.pedido_enviado_rastreio?.status, "APPROVED");
  let pagedShipmentCreates = 0;
  await provisionMissingShipmentTemplate({
    wabaId: "waba", accessToken: "secret", snapshot: pagedSnapshot, now: 200,
    fetchSnapshot: async () => pagedSnapshot,
    createShipment: async () => { pagedShipmentCreates++; return { created: true, alreadyExisted: false }; },
  });
  assert.equal(pagedShipmentCreates, 0);

  // Uma página intermediária incompleta nunca produz uma lista de ausentes.
  let failingPage = 0;
  await assert.rejects(fetchCanonicalTemplateSnapshot("waba", "secret", async () => {
    failingPage++;
    return failingPage === 1
      ? new Response(JSON.stringify({ data: [], paging: { next: "https://graph.facebook.com/v22.0/waba/message_templates?after=1" } }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 2 } }), { status: 503 });
  }), /meta_template_lookup_failed/);

  await assert.rejects(fetchCanonicalTemplateSnapshot("waba", "secret", async () => new Response(JSON.stringify({
    data: [], paging: { next: "https://attacker.example/templates" },
  }), { status: 200 })), /meta_template_invalid_paging_url/);

  const repeated = "https://graph.facebook.com/v22.0/waba/message_templates?after=same";
  await assert.rejects(fetchCanonicalTemplateSnapshot("waba", "secret", async () => new Response(JSON.stringify({
    data: [], paging: { next: repeated },
  }), { status: 200 })), /meta_template_pagination_loop/);

  // Template de envio presente: não há POST nem duplicata.
  let shipmentCreates = 0;
  const shipmentPresent = {
    found: { pedido_enviado_rastreio: approved.pedido_enviado_rastreio },
    missing: keys.filter((key) => key !== "pedido_enviado_rastreio"),
  };
  const presentResult = await provisionMissingShipmentTemplate({
    wabaId: "waba", accessToken: "secret", snapshot: shipmentPresent, now: 200,
    fetchSnapshot: async () => shipmentPresent,
    createShipment: async () => { shipmentCreates++; return { created: true, alreadyExisted: false }; },
  });
  assert.equal(presentResult.created, false);
  assert.equal(shipmentCreates, 0);

  // Ausente confirmado: cria apenas o quarto e permanece PENDING.
  const absentSnapshot = { found: {}, missing: [...keys] };
  const createdShipment = await provisionMissingShipmentTemplate({
    wabaId: "waba", accessToken: "secret", snapshot: absentSnapshot, now: 200,
    fetchSnapshot: async () => absentSnapshot,
    createShipment: async (_w, _t, template) => {
      shipmentCreates++;
      assert.equal(template.key, "pedido_enviado_rastreio");
      return { created: true, alreadyExisted: false };
    },
  });
  assert.equal(createdShipment.provision && createdShipment.provision !== "failed" ? createdShipment.provision.status : undefined, "PENDING");

  // Corrida/already-exists: relê a Meta, não tenta criar novamente nem assume aprovação.
  let refetches = 0;
  const duplicateSafe = await provisionMissingShipmentTemplate({
    wabaId: "waba", accessToken: "secret", snapshot: absentSnapshot, now: 200,
    fetchSnapshot: async () => { refetches++; return shipmentPresent; },
    createShipment: async () => ({ created: false, alreadyExisted: true }),
  });
  assert.equal(refetches, 1);
  assert.equal(duplicateSafe.snapshot.found.pedido_enviado_rastreio?.status, "APPROVED");

  // Dois refreshes que observaram ausência convergem por created/already exists.
  let actuallyCreated = false;
  let providerCreateCount = 0;
  const concurrentCreate = async () => {
    providerCreateCount++;
    if (!actuallyCreated) {
      actuallyCreated = true;
      return { created: true, alreadyExisted: false };
    }
    return { created: false, alreadyExisted: true };
  };
  const [firstCreate, secondCreate] = await Promise.all([
    provisionMissingShipmentTemplate({
      wabaId: "waba", accessToken: "secret", snapshot: absentSnapshot, now: 300,
      fetchSnapshot: async () => shipmentPresent, createShipment: concurrentCreate,
    }),
    provisionMissingShipmentTemplate({
      wabaId: "waba", accessToken: "secret", snapshot: absentSnapshot, now: 301,
      fetchSnapshot: async () => shipmentPresent, createShipment: concurrentCreate,
    }),
  ]);
  assert.equal(providerCreateCount, 2);
  assert.equal([firstCreate, secondCreate].filter((result) => result.created).length, 1);
  assert.equal([firstCreate, secondCreate].filter((result) => result.snapshot.found.pedido_enviado_rastreio).length, 1);

  // Falha do provider mantém o snapshot anterior e marca falha fail-closed.
  const providerFailure = await provisionMissingShipmentTemplate({
    wabaId: "waba", accessToken: "secret", snapshot: absentSnapshot, now: 200,
    fetchSnapshot: async () => absentSnapshot,
    createShipment: async () => { throw new Error("temporary"); },
  });
  assert.equal(providerFailure.snapshot, absentSnapshot);
  assert.equal(providerFailure.provision, "failed");

  // O payload consumido pelo dashboard reflete APPROVED reconciliado.
  const dashboardPayload = whatsappStatusPayload({
    wabaId: "waba", phoneNumberId: "phone", accessToken: "secret", status: "connected", connectedAt: 1,
    templates: approved,
  });
  assert.equal(dashboardPayload.templates.pedido_pagamento_confirmado.status, "APPROVED");
  console.log("WhatsApp multi-template lifecycle: OK");
}

main().catch((error: unknown) => {
  console.error("WhatsApp multi-template lifecycle failed", { name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : "unknown" });
  process.exitCode = 1;
});

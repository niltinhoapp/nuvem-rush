import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WHATSAPP_TEMPLATE_CATALOG,
  catalogTemplateForEvent,
} from "../lib/whatsapp/catalog";

function main() {
  const nodesSource = readFileSync(new URL("../components/flow-builder/nodes.tsx", import.meta.url), "utf8");
  const flowBuilderSource = readFileSync(new URL("../components/flow-builder/FlowBuilder.tsx", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");

  // A: o bloco do step whatsapp não referencia mais o Prompt de IA.
  const whatsappBlock = nodesSource.slice(
    nodesSource.indexOf('step.action === "whatsapp"'),
    nodesSource.indexOf("step.action === \"tag\""),
  );
  assert.doesNotMatch(whatsappBlock, /Prompt de IA/);
  assert.doesNotMatch(whatsappBlock, /aiPrompt/);

  // B: o bloco do step email continua com o Prompt de IA intacto.
  const emailBlock = nodesSource.slice(
    nodesSource.indexOf('step.action === "email"'),
    nodesSource.indexOf('step.action === "whatsapp"'),
  );
  assert.match(emailBlock, /Prompt de IA/);
  assert.match(emailBlock, /aiPrompt/);

  // Confirma que o bloco compartilhado antigo (email || whatsapp) não existe mais.
  assert.doesNotMatch(nodesSource, /step\.action === "email" \|\| step\.action === "whatsapp"/);

  // C: pos_venda_agradecimento não tem campo "event" no catálogo (sem trigger
  // fictício) e nenhum seletor faz referência a essa chave no flow builder.
  assert.doesNotMatch(nodesSource, /pos_venda_agradecimento/);
  assert.doesNotMatch(flowBuilderSource, /pos_venda_agradecimento/);
  assert.ok(!("event" in WHATSAPP_TEMPLATE_CATALOG.pos_venda_agradecimento));

  // D: order_created continua sem mapeamento automático (função pura real).
  assert.equal(catalogTemplateForEvent("order_created"), undefined);
  // E o step whatsapp mostra mensagem honesta de indisponibilidade, não um
  // seletor que finge funcionar.
  assert.match(whatsappBlock, /ainda não tem um template de WhatsApp automático/);

  // E: dashboard continua listando os 4 templates com status independente
  // (regressão — arquivo não foi tocado por este patch).
  assert.match(dashboardSource, /WHATSAPP_TEMPLATE_CATALOG_KEYS/);

  // F: guard de envio permanece por template aprovado (regressão — arquivo
  // não foi tocado por este patch; a garantia já é coberta pelos testes do
  // lifecycle multi-template existentes).
  const templateStatusSource = readFileSync(new URL("../lib/whatsapp/templateStatus.ts", import.meta.url), "utf8");
  assert.match(templateStatusSource, /isTemplateApproved/);

  // G: os três mapeamentos automáticos existentes continuam corretos.
  assert.equal(catalogTemplateForEvent("cart_abandoned")?.key, "carrinho_abandonado");
  assert.equal(catalogTemplateForEvent("order_paid")?.key, "pedido_pagamento_confirmado");
  assert.equal(catalogTemplateForEvent("order_fulfilled")?.key, "pedido_enviado_rastreio");

  // FlowBuilder repassa o evento do gatilho aos steps (sem isso o step
  // whatsapp não sabe qual template mostrar).
  assert.match(flowBuilderSource, /triggerEvent/);

  console.log("WhatsApp template UX P2: OK");
}

main();

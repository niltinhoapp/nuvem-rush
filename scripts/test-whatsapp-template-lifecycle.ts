import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TEMPLATE_NOT_APPROVED_ERROR,
  assertCommercialTemplateApproved,
  canApplyTemplateStatusUpdate,
  initialTemplateStatus,
  parseMetaTemplateStatusUpdate,
  templateStatusLabel,
} from "../lib/whatsapp/templateStatus";
import { isTransient } from "../lib/dispatch/retry";

const entry = { id: "waba-a", time: 1_700_000_000 };
const change = (event: string, name = "pos_venda_agradecimento") => ({
  field: "message_template_status_update",
  value: {
    event,
    message_template_id: "template-id-not-persisted",
    message_template_name: name,
    message_template_language: "pt_BR",
  },
});
const defaultTemplate = {
  wabaId: "waba-a",
  templateName: "pos_venda_agradecimento",
  templateLang: "pt_BR",
  templateStatusUpdatedAt: 1_700_000_000_000,
};

function throwsNotApproved(status: string | undefined, name = "pos_venda_agradecimento") {
  assert.throws(
    () => assertCommercialTemplateApproved({
      whatsapp: { ...defaultTemplate, templateStatus: status },
      name,
      language: "pt_BR",
    }),
    new RegExp(TEMPLATE_NOT_APPROVED_ERROR),
  );
}

function main() {
  // A: create accepted starts pending unless the Graph response says otherwise.
  assert.equal(initialTemplateStatus(undefined), "PENDING");
  assert.equal(initialTemplateStatus("approved"), "APPROVED");

  // B-E: official template lifecycle payload parsing.
  for (const status of ["PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"]) {
    const parsed = parseMetaTemplateStatusUpdate(entry, change(status));
    assert.equal(parsed?.status, status);
    assert.equal(parsed?.wabaId, "waba-a");
    assert.equal(parsed?.receivedAt, 1_700_000_000_000);
  }

  // F-H: WABA/name/language isolation and stale/duplicate safety.
  const approved = parseMetaTemplateStatusUpdate(entry, change("APPROVED"))!;
  assert.equal(canApplyTemplateStatusUpdate({ storeActive: true, whatsapp: defaultTemplate, ...approved }), false);
  assert.equal(canApplyTemplateStatusUpdate({ storeActive: true, whatsapp: defaultTemplate, ...approved, wabaId: "waba-b" }), false);
  assert.equal(canApplyTemplateStatusUpdate({ storeActive: true, whatsapp: defaultTemplate, ...approved, name: "other_template" }), false);
  assert.equal(canApplyTemplateStatusUpdate({ storeActive: true, whatsapp: defaultTemplate, ...approved, receivedAt: 1_699_999_999_000 }), false);
  assert.equal(canApplyTemplateStatusUpdate({
    storeActive: true,
    whatsapp: defaultTemplate,
    ...approved,
    receivedAt: 1_700_000_001_000,
  }), true);

  // I-N: only the known approved default may pass the commercial send guard.
  assert.doesNotThrow(() => assertCommercialTemplateApproved({
    whatsapp: { ...defaultTemplate, templateStatus: "APPROVED" },
    name: "pos_venda_agradecimento",
    language: "pt_BR",
  }));
  for (const status of ["PENDING", "REJECTED", "PAUSED", "DISABLED", undefined]) throwsNotApproved(status);
  throwsNotApproved("APPROVED", "other_template");

  // O: blocked template status is terminal, avoiding a retry storm.
  assert.equal(isTransient(new Error(TEMPLATE_NOT_APPROVED_ERROR)), false);

  // P-Q-R: minimal UI, no raw connect detail and no raw Meta persistence.
  assert.equal(templateStatusLabel("APPROVED"), "Aprovado");
  assert.equal(templateStatusLabel(undefined), "Indisponível");
  const connect = readFileSync(new URL("../app/api/whatsapp/connect/route.ts", import.meta.url), "utf8");
  const webhook = readFileSync(new URL("../app/api/webhooks/whatsapp/route.ts", import.meta.url), "utf8");
  const templateStatus = readFileSync(new URL("../lib/whatsapp/templateStatus.ts", import.meta.url), "utf8");
  const templateRepository = readFileSync(new URL("../lib/whatsapp/templateStatus.firestore.ts", import.meta.url), "utf8");
  const channel = readFileSync(new URL("../lib/channels/whatsapp.ts", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  assert.match(connect, /templateStatus/);
  assert.doesNotMatch(connect, /detail:\s*String\(err\)/);
  assert.match(webhook, /parseMetaTemplateStatusUpdate/);
  assert.match(templateStatus, /message_template_status_update/);
  assert.match(webhook, /updateTemplateStatus/);
  assert.match(templateRepository, /whatsapp\.wabaId/);
  assert.match(channel, /assertCommercialTemplateApproved/);
  assert.ok(channel.indexOf("assertCommercialTemplateApproved") < channel.indexOf("graph.facebook.com"));
  assert.match(dashboard, /As automações de WhatsApp só enviarão após a aprovação/);

  console.log("WhatsApp template lifecycle: OK");
}

main();

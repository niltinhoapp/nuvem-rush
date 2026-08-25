import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-whatsapp-template" });

async function main() {
  const db = getFirestore();
  const { parseMetaTemplateStatusUpdate } = await import("../lib/whatsapp/templateStatus");
  const { updateTemplateStatus } = await import("../lib/whatsapp/templateStatus.firestore");
  const stores = ["template-ambiguous-a", "template-ambiguous-b", "template-a", "template-b", "template-order"];
  for (const storeId of stores) await db.recursiveDelete(db.doc(`stores/${storeId}`));

  const templateName = "pos_venda_agradecimento";
  const language = "pt_BR";

  async function seed(
    storeId: string,
    wabaId: string,
    templateStatus = "PENDING",
    templateStatusUpdatedAt = 0,
  ) {
    await db.doc(`stores/${storeId}`).set({
      status: "active",
      whatsapp: {
        wabaId,
        phoneNumberId: `phone-${storeId}`,
        accessToken: "fixture-token-not-used",
        status: "connected",
        templateName,
        templateLang: language,
        templateStatus,
        templateStatusUpdatedAt,
        connectedAt: 1,
      },
    });
  }

  function event(
    wabaId: string,
    status: string,
    seconds: number,
    name = templateName,
    lang = language,
  ) {
    const parsed = parseMetaTemplateStatusUpdate(
      { id: wabaId, time: seconds },
      {
        field: "message_template_status_update",
        value: {
          event: status,
          message_template_name: name,
          message_template_language: lang,
        },
      },
    );
    assert.ok(parsed, "payload oficial deve ser parseado");
    return parsed;
  }

  async function template(storeId: string) {
    return (await db.doc(`stores/${storeId}`).get()).data()?.whatsapp;
  }

  // 1/8: query real limitada a duas stores bloqueia WABA ambigua sem escrita.
  await seed("template-ambiguous-a", "same-waba");
  await seed("template-ambiguous-b", "same-waba");
  const ambiguousQuery = await db.collection("stores")
    .where("whatsapp.wabaId", "==", "same-waba")
    .limit(2)
    .get();
  assert.equal(ambiguousQuery.size, 2, "query real encontra as duas stores ambiguas");
  assert.equal(await updateTemplateStatus(event("same-waba", "APPROVED", 200)), "ignored_missing_or_ambiguous_waba");
  assert.equal((await template("template-ambiguous-a"))?.templateStatus, "PENDING");
  assert.equal((await template("template-ambiguous-b"))?.templateStatus, "PENDING");

  // 2/3/7: update transacional na unica tenant, com timestamp oficial em segundos -> ms.
  await seed("template-a", "waba-a");
  await seed("template-b", "waba-b");
  assert.equal(await updateTemplateStatus(event("waba-a", "APPROVED", 200)), "updated");
  const afterApproved = await template("template-a");
  assert.equal(afterApproved?.templateStatus, "APPROVED");
  assert.equal(afterApproved?.templateStatusUpdatedAt, 200_000);
  assert.equal((await template("template-b"))?.templateStatus, "PENDING");
  assert.equal(await updateTemplateStatus(event("waba-a", "PENDING", 300, "other_template")), "ignored_store_or_template_mismatch");
  assert.equal(await updateTemplateStatus(event("waba-a", "PENDING", 300, templateName, "en_US")), "ignored_store_or_template_mismatch");
  assert.equal((await template("template-a"))?.templateStatus, "APPROVED");

  // 4: concorrencia stale, inclusive com ordem invertida das Promises.
  for (const reverse of [false, true]) {
    await seed("template-order", "waba-order", "PENDING", 0);
    const newest = event("waba-order", "APPROVED", 200);
    const oldest = event("waba-order", "PENDING", 100);
    await Promise.all(reverse
      ? [updateTemplateStatus(oldest), updateTemplateStatus(newest)]
      : [updateTemplateStatus(newest), updateTemplateStatus(oldest)]);
    const final = await template("template-order");
    assert.equal(final?.templateStatus, "APPROVED");
    assert.equal(final?.templateStatusUpdatedAt, 200_000);
  }

  // 5: o evento mais novo prevalece mesmo quando ele e terminal/rejeitado.
  await seed("template-order", "waba-order", "PENDING", 0);
  await Promise.all([
    updateTemplateStatus(event("waba-order", "REJECTED", 200)),
    updateTemplateStatus(event("waba-order", "APPROVED", 100)),
  ]);
  assert.equal((await template("template-order"))?.templateStatus, "REJECTED");
  assert.equal((await template("template-order"))?.templateStatusUpdatedAt, 200_000);

  // 6: duplicata e semanticamente idempotente e nao gera erro.
  const duplicate = event("waba-order", "REJECTED", 200);
  const duplicateResults = await Promise.all([updateTemplateStatus(duplicate), updateTemplateStatus(duplicate)]);
  assert.deepEqual(duplicateResults, ["updated", "updated"]);
  assert.equal((await template("template-order"))?.templateStatus, "REJECTED");

  // 8: WABA inexistente e ignorada com seguranca.
  assert.equal(await updateTemplateStatus(event("missing-waba", "APPROVED", 200)), "ignored_missing_or_ambiguous_waba");

  console.log("WhatsApp template lifecycle Firestore Emulator: OK");
}

main().catch((error: unknown) => {
  console.error("WhatsApp template lifecycle Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});

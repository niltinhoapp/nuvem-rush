import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  classifyWebhookRegistrationError,
  registerRequiredWebhooks,
} from "../lib/nuvemshop/webhook-registration";
import { REQUIRED_WEBHOOK_EVENTS } from "../lib/nuvemshop/webhooks";

async function main() {
  assert.equal(REQUIRED_WEBHOOK_EVENTS.includes("product/created" as never), false);
  assert.equal(REQUIRED_WEBHOOK_EVENTS.includes("product/updated" as never), false);

  const called: string[] = [];
  const results = await registerRequiredWebhooks({
    async listWebhooks() {
      return [];
    },
    async createWebhook(event) {
      called.push(event);
      if (event === "order/paid") throw Object.assign(new Error("rate limited"), { status: 429 });
      if (event === "order/fulfilled") throw new Error("Nuvemshop API 503: unavailable");
      if (event === "order/cancelled") throw Object.assign(new Error("invalid"), { status: 422 });
      return { ok: true };
    },
  }, "https://example.invalid/webhook");

  assert.deepEqual(called, [...REQUIRED_WEBHOOK_EVENTS]);
  assert.equal(results.find((r) => r.event === "order/created")?.status, "success");
  assert.equal(results.find((r) => r.event === "order/created")?.action, "created");
  assert.equal(results.find((r) => r.event === "order/paid")?.status, "transient_error");
  assert.equal(results.find((r) => r.event === "order/fulfilled")?.status, "transient_error");
  assert.equal(results.find((r) => r.event === "order/cancelled")?.status, "permanent_error");
  assert.deepEqual(
    classifyWebhookRegistrationError("app/uninstalled", Object.assign(new Error("timeout"), { name: "AbortError" })),
    { event: "app/uninstalled", status: "transient_error" },
  );

  const webhookUrl = "https://example.invalid/webhook";
  const persisted: Array<{ event: string; url: string }> = [];
  let attempt = 1;
  const createdByAttempt: string[][] = [[], []];
  const registrar = {
    async listWebhooks(event: string, url: string) {
      return persisted.filter((webhook) => webhook.event === event && webhook.url === url);
    },
    async createWebhook(event: string, url: string) {
      createdByAttempt[attempt - 1]!.push(event);
      if (attempt === 1 && event === REQUIRED_WEBHOOK_EVENTS.at(-1)) {
        throw Object.assign(new Error("temporary failure"), { status: 503 });
      }
      persisted.push({ event, url });
    },
  };

  const firstAttempt = await registerRequiredWebhooks(registrar, webhookUrl);
  assert.equal(firstAttempt.filter((result) => result.status === "success").length, REQUIRED_WEBHOOK_EVENTS.length - 1);
  assert.equal(firstAttempt.at(-1)?.status, "transient_error");

  attempt = 2;
  const secondAttempt = await registerRequiredWebhooks(registrar, webhookUrl);
  assert.deepEqual(createdByAttempt[1], [REQUIRED_WEBHOOK_EVENTS.at(-1)]);
  assert.equal(secondAttempt.filter((result) => result.action === "reused").length, REQUIRED_WEBHOOK_EVENTS.length - 1);
  assert.equal(secondAttempt.at(-1)?.action, "created");
  for (const event of REQUIRED_WEBHOOK_EVENTS) {
    assert.equal(
      persisted.filter((webhook) => webhook.event === event && webhook.url === webhookUrl).length,
      1,
    );
  }

  let createAfterListFailure = false;
  const listFailure = await registerRequiredWebhooks({
    async listWebhooks() {
      throw Object.assign(new Error("listing unavailable"), { status: 503 });
    },
    async createWebhook() {
      createAfterListFailure = true;
    },
  }, webhookUrl);
  assert.equal(createAfterListFailure, false);
  assert.equal(listFailure.every((result) => result.status === "transient_error"), true);

  const callback = await readFile(
    new URL("../app/api/auth/nuvemshop/callback/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(callback, /webhookRegistration/);
  assert.match(callback, /status: 503/);
  assert.doesNotMatch(callback, /Promise\.allSettled/);
  console.log("webhook registration reliability: OK");
}

void main();

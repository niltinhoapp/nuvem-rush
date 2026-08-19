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
  assert.equal(results.find((r) => r.event === "order/paid")?.status, "transient_error");
  assert.equal(results.find((r) => r.event === "order/fulfilled")?.status, "transient_error");
  assert.equal(results.find((r) => r.event === "order/cancelled")?.status, "permanent_error");
  assert.deepEqual(
    classifyWebhookRegistrationError("app/uninstalled", Object.assign(new Error("timeout"), { name: "AbortError" })),
    { event: "app/uninstalled", status: "transient_error" },
  );

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

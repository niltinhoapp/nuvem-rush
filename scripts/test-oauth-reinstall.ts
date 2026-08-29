import assert from "node:assert/strict";
import { buildStoreInstallData } from "../lib/nuvemshop/store-install";
import { PLANS } from "../lib/plans";

const now = Date.UTC(2026, 7, 18, 12, 0, 0);

const firstInstall = buildStoreInstallData(
  "7865512",
  { accessToken: "new-token", scope: "read_orders,write_webhooks" },
  { exists: false },
  now,
);

assert.deepEqual(firstInstall, {
  storeId: "7865512",
  accessToken: "new-token",
  scope: "read_orders,write_webhooks",
  status: "active",
  plan: "essencial",
  installedAt: now,
  quotas: {
    contactsLimit: PLANS.essencial.contactsLimit,
    dispatchesMonthLimit: PLANS.essencial.emailsMonthLimit,
    dispatchesMonthUsed: 0,
    whatsappMonthLimit: PLANS.essencial.whatsappMonthLimit,
    whatsappMonthUsed: 0,
    periodKey: "2026-08",
  },
});

const existingStore = {
  storeId: "7865512",
  accessToken: "stale-token",
  scope: "read_orders",
  status: "uninstalled",
  plan: "turbo",
  installedAt: 1_700_000_000_000,
  quotas: {
    contactsLimit: 50_000,
    dispatchesMonthLimit: 20_000,
    dispatchesMonthUsed: 1_234,
    whatsappMonthLimit: 5_000,
    whatsappMonthUsed: 321,
    periodKey: "2026-08",
  },
  customField: "preserve-me",
};

const reinstallPatch = buildStoreInstallData(
  "7865512",
  { accessToken: "fresh-token", scope: "read_orders,write_webhooks" },
  { exists: true, status: existingStore.status },
  now,
);
const reinstalledStore = { ...existingStore, ...reinstallPatch };

assert.equal(reinstalledStore.storeId, "7865512", "storeId deve continuar deterministico");
assert.equal(reinstalledStore.plan, "turbo", "reinstalacao deve preservar o plano");
assert.deepEqual(reinstalledStore.quotas, existingStore.quotas, "reinstalacao deve preservar cotas e uso");
assert.equal(reinstalledStore.installedAt, existingStore.installedAt, "reinstalacao deve preservar installedAt");
assert.equal(reinstalledStore.accessToken, "fresh-token", "reinstalacao deve atualizar accessToken");
assert.equal(reinstalledStore.status, "active", "reinstalacao deve reativar a loja");
assert.equal(reinstalledStore.scope, "read_orders,write_webhooks", "reinstalacao deve atualizar scope");
assert.equal(reinstalledStore.customField, "preserve-me", "merge deve preservar campos extras");
assert.equal("plan" in reinstallPatch, false, "patch de reinstalacao nao deve sobrescrever plan");
assert.equal("quotas" in reinstallPatch, false, "patch de reinstalacao nao deve sobrescrever quotas");
assert.equal("installedAt" in reinstallPatch, false, "patch de reinstalacao nao deve sobrescrever installedAt");

const redactedTombstone = {
  status: "redacted",
  redactionRequestId: "opaque-request",
  redactedAt: now - 1,
  tombstoneVersion: 1,
};
const postRedactInstall = buildStoreInstallData(
  "7865512",
  { accessToken: "post-redact-token", scope: "read_orders,write_webhooks" },
  { exists: true, status: redactedTombstone.status },
  now,
);
assert.equal(postRedactInstall.status, "active");
assert.equal(postRedactInstall.accessToken, "post-redact-token");
assert.equal(postRedactInstall.plan, "essencial");
assert.equal(postRedactInstall.installedAt, now);
assert.equal(postRedactInstall.quotas?.dispatchesMonthUsed, 0);
assert.equal(postRedactInstall.quotas?.whatsappMonthUsed, 0);
assert.equal("redactedAt" in postRedactInstall, false);
assert.equal("redactionRequestId" in postRedactInstall, false);

console.log("test-oauth-reinstall: OK");

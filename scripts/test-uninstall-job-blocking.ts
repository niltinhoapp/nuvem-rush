import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runWithFinalCommercialGuard } from "../lib/dispatch/finalGuard";

type JobStatus = "scheduled" | "processing" | "cancelled" | "sent";
type State = {
  storeStatus: "active" | "uninstalled";
  uninstalledAt?: number;
  plan: string;
  token: string;
  flows: number;
  quota: number;
  job: JobStatus;
  enrollmentActive: boolean;
  providerCalls: number;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

function uninstall(state: State, now = 123): boolean {
  const repeated = state.storeStatus === "uninstalled";
  state.storeStatus = "uninstalled";
  state.uninstalledAt ??= now;
  if (state.job === "scheduled" || state.job === "processing") state.job = "cancelled";
  return repeated;
}

async function guardedDispatch(
  state: State,
  afterClaim?: () => Promise<void>,
  providerHook?: () => Promise<void>,
) {
  if (state.storeStatus !== "active") {
    if (state.job === "scheduled" || state.job === "processing") state.job = "cancelled";
    return;
  }
  if (state.job !== "scheduled") return;
  state.job = "processing";
  await afterClaim?.();

  const result = await runWithFinalCommercialGuard(
    async () => ({
      storeActive: state.storeStatus === "active",
      commercialAccess: true,
      jobProcessing: state.job === "processing",
      enrollmentActive: state.enrollmentActive,
    }),
    async () => {
      state.providerCalls++;
      await providerHook?.();
    },
  );
  if (result.status === "blocked" && state.job === "processing") state.job = "cancelled";
  if (
    result.status === "sent"
    && state.storeStatus === "active"
    && state.job === "processing"
  ) {
    state.job = "sent";
    state.quota++;
  }
}

function fixture(job: JobStatus = "scheduled"): State {
  return {
    storeStatus: "active", plan: "essencial", token: "test-only", flows: 5,
    quota: 0, job, enrollmentActive: true, providerCalls: 0,
  };
}

async function main() {
// A — scheduled cancelado antes da tentativa de dispatch.
{
  const s = fixture();
  uninstall(s);
  await guardedDispatch(s);
  assert.equal(s.job, "cancelled");
  assert.equal(s.providerCalls, 0);
  assert.equal(s.quota, 0);
}

// B — claim -> barrier -> uninstall -> revalidacao final -> zero provider.
{
  const s = fixture();
  const claimed = deferred();
  const resume = deferred();
  const dispatch = guardedDispatch(s, async () => {
    claimed.resolve();
    await resume.promise;
  });
  await claimed.promise;
  assert.equal(s.job, "processing");
  uninstall(s);
  resume.resolve();
  await dispatch;
  assert.equal(s.job, "cancelled");
  assert.equal(s.providerCalls, 0);
  assert.equal(s.quota, 0);
}

// C — uninstall antes do claim.
{
  const s = fixture();
  uninstall(s);
  await guardedDispatch(s);
  assert.equal(s.job, "cancelled");
  assert.equal(s.providerCalls, 0);
}

// B2 — provider ja iniciou; uninstall nao pode reverter cancelled para sent.
{
  const s = fixture();
  const providerStarted = deferred();
  const providerDone = deferred();
  const dispatch = guardedDispatch(s, undefined, async () => {
    providerStarted.resolve();
    await providerDone.promise;
  });
  await providerStarted.promise;
  uninstall(s);
  providerDone.resolve();
  await dispatch;
  assert.equal(s.job, "cancelled");
  assert.equal(s.providerCalls, 1, "provider ja havia iniciado antes do uninstall");
  assert.equal(s.quota, 0, "uninstall durante provider nao pode consumir cota");
}

// D — transacao de enrollment observa store uninstalled e nao cria job.
{
  const s = fixture();
  const beforeRead = deferred();
  const continueTx = deferred();
  let created = false;
  const tx = (async () => {
    beforeRead.resolve();
    await continueTx.promise;
    if (s.storeStatus === "active") created = true;
  })();
  await beforeRead.promise;
  uninstall(s);
  continueTx.resolve();
  await tx;
  assert.equal(created, false);
  assert.equal(s.providerCalls, 0);
}

// E — sent e historico imutavel.
{
  const s = fixture("sent");
  uninstall(s);
  assert.equal(s.job, "sent");
}

// F — uninstall idempotente e dados comerciais preservados.
{
  const s = fixture();
  assert.equal(uninstall(s, 123), false);
  assert.equal(uninstall(s, 456), true);
  assert.equal(s.uninstalledAt, 123);
  assert.equal(s.plan, "essencial");
  assert.equal(s.token, "test-only");
  assert.equal(s.flows, 5);
  assert.equal(s.providerCalls, 0);
}

// G — trabalho novo apos uninstall nao inicia.
{
  const s = fixture();
  uninstall(s);
  let enrollmentCreated = false;
  if (s.storeStatus === "active") enrollmentCreated = true;
  await guardedDispatch(s);
  assert.equal(enrollmentCreated, false);
  assert.equal(s.providerCalls, 0);
}

// O codigo real deve usar a guarda final e preservar o gate transacional.
const dispatchSource = readFileSync(new URL("../lib/dispatch.ts", import.meta.url), "utf8");
const processSource = readFileSync(new URL("../lib/rules/process.ts", import.meta.url), "utf8");
assert.match(dispatchSource, /runWithFinalCommercialGuard/);
assert.match(dispatchSource, /hasMatchingQuotaReservation/);
assert.match(processSource, /tx\.get\(storeRef\(storeId\)\)/);
assert.match(processSource, /isStoreCommerciallyActive\(storeSnap\.data\(\)\?\.status\)/);

console.log("ITEM 10 uninstall job blocking: OK");
}

void main();

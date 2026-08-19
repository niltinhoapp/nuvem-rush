import assert from "node:assert/strict";
import {
  NuvemshopApiError,
  NuvemshopClient,
  NuvemshopRequestError,
} from "../lib/nuvemshop/client";

async function main() {
  const sleeps: number[] = [];
  let calls = 0;
  const retry429 = new NuvemshopClient("1", "secret", {
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response("rate", { status: 429, headers: { "x-rate-limit-reset": "1200" } })
        : Response.json({ ok: true });
    },
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0,
  });
  assert.deepEqual(await retry429.getStore(), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1200]);

  calls = 0;
  const retry503 = new NuvemshopClient("1", "secret", {
    fetchImpl: async () => (++calls === 1 ? new Response("down", { status: 503 }) : Response.json([])),
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0,
  });
  await retry503.listProducts();
  assert.equal(calls, 2, "GET 5xx deve ter retry limitado");

  calls = 0;
  const noPostRetry = new NuvemshopClient("1", "secret", {
    fetchImpl: async () => { calls++; return new Response("down", { status: 503 }); },
    sleep: async () => { throw new Error("POST nao deve aguardar retry"); },
  });
  await assert.rejects(
    () => noPostRetry.createWebhook("order/created", "https://example.invalid"),
    (error: unknown) => error instanceof NuvemshopApiError && error.status === 503 && error.transient,
  );
  assert.equal(calls, 1, "POST webhook nao pode repetir automaticamente");

  const permanent = new NuvemshopClient("1", "secret", {
    fetchImpl: async () => new Response("invalid", { status: 422 }),
  });
  await assert.rejects(
    () => permanent.getStore(),
    (error: unknown) => error instanceof NuvemshopApiError && !error.transient,
  );

  calls = 0;
  const timeout = new NuvemshopClient("1", "secret", {
    fetchImpl: ((_input, init) => new Promise((_resolve, reject) => {
      calls++;
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as typeof fetch,
    timeoutMs: 1,
    maxReadRetries: 0,
  });
  await assert.rejects(
    () => timeout.getStore(),
    (error: unknown) => error instanceof NuvemshopRequestError && error.transient,
  );
  assert.equal(calls, 1);
  console.log("nuvemshop client resilience: OK");
}

void main();

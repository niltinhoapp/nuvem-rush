import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NuvemshopClient } from "../lib/nuvemshop/client";

async function main() {
  let calls = 0;
  const client = new NuvemshopClient("store-1", "test-token", {
    fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "x-rate-limit-reset": "0" },
        });
      }
      if (calls === 2) {
        return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
          status: 200,
          headers: {
            "x-total-count": "3",
            link: '<https://api.tiendanube.com/v1/store-1/checkouts?page=2&per_page=2>; rel="next"',
          },
        });
      }
      return new Response(JSON.stringify([{ id: 3 }]), {
        status: 200,
        headers: { "x-total-count": "3" },
      });
    },
    sleep: async () => {},
    random: () => 0,
  });
  const checkouts = await client.listCheckouts(undefined, 2);
  assert.deepEqual(checkouts.map((checkout) => checkout.id), [1, 2, 3]);
  assert.equal(calls, 3, "429 deve repetir a pagina sem perder o snapshot");

  const cron = readFileSync(new URL("../app/api/cron/cart-signals/route.ts", import.meta.url), "utf8");
  assert.match(cron, /cart_signals_telemetry_only/);
  assert.doesNotMatch(cron, /enrollCartOnce|syncAbandonedCheckout|collectionGroup/);

  const uninstall = readFileSync(new URL("../lib/lifecycle/uninstall.ts", import.meta.url), "utf8");
  assert.match(uninstall, /"scheduled", "processing"/);
  assert.match(uninstall, /status: "cancelled"/);
  assert.doesNotMatch(uninstall, /delete\(/);

  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /allow read, write: if false/);

  const session = readFileSync(new URL("../lib/auth/sessionToken.ts", import.meta.url), "utf8");
  assert.match(session, /!secret\?\.trim\(\)/);

  console.log("pre-homologation integration: OK");
}

void main();

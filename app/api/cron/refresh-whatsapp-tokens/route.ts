// Cron (Vercel): renova os business tokens das lojas conectadas via
// Embedded Signup. A config emite tokens de 60 dias; renovamos todo token
// com mais de 30 dias, entao nunca chegamos perto de expirar.
//
// Protegido pelo CRON_SECRET (Authorization: Bearer <CRON_SECRET>).
// Agendado em vercel.json: 1x por dia; so faz chamadas quando ha token velho.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { refreshBusinessToken } from "@/lib/whatsapp/embedded";
import type { Store } from "@/types";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  // Fail-closed: sem CRON_SECRET configurado, recusa (nao expoe o cron).
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const snap = await db
    .collection("stores")
    .where("whatsapp.status", "==", "connected")
    .get();

  const now = Date.now();
  let refreshed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const doc of snap.docs) {
    const store = doc.data() as Store;
    const wa = store.whatsapp!;
    const tokenAge = now - (wa.tokenRefreshedAt ?? wa.connectedAt);
    if (tokenAge < THIRTY_DAYS_MS) {
      skipped++;
      continue;
    }
    try {
      const newToken = await refreshBusinessToken(wa.accessToken);
      const persisted = await db.runTransaction(async (tx) => {
        const current = await tx.get(doc.ref);
        if (!isStoreCommerciallyActive(current.data()?.status)) return false;
        tx.update(doc.ref, {
          "whatsapp.accessToken": newToken, // TODO: criptografar em repouso
          "whatsapp.tokenRefreshedAt": now,
          // Sucesso: limpa qualquer falha anterior.
          "whatsapp.lastRefreshError": null,
          "whatsapp.refreshFailCount": 0,
        });
        return true;
      });
      if (persisted) refreshed++;
      else skipped++;
    } catch (err) {
      // Nao interrompe o lote, mas PERSISTE a falha na loja (visivel na UI e
      // consultavel) — antes ia so no JSON de resposta, que ninguem le.
      // Se falhar por ~30 dias seguidos, o token expira e o canal para: com
      // isto da para alertar/mostrar antes disso.
      const failCount = (wa.refreshFailCount ?? 0) + 1;
      const persisted = await db.runTransaction(async (tx) => {
        const current = await tx.get(doc.ref);
        if (!isStoreCommerciallyActive(current.data()?.status)) return false;
        tx.update(doc.ref, {
          "whatsapp.lastRefreshError": String(err),
          "whatsapp.lastRefreshAttempt": now,
          "whatsapp.refreshFailCount": failCount,
        });
        return true;
      });
      if (persisted) {
        errors.push(`${doc.id}: ${String(err)}`);
        console.error(
          `[refresh-whatsapp-tokens] falha na loja ${doc.id} (tentativa ${failCount}):`,
          err,
        );
      } else {
        skipped++;
      }
    }
  }

  return NextResponse.json({ total: snap.size, refreshed, skipped, errors });
}

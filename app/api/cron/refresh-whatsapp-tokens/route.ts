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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
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
      await doc.ref.update({
        "whatsapp.accessToken": newToken, // TODO: criptografar em repouso
        "whatsapp.tokenRefreshedAt": now,
      });
      refreshed++;
    } catch (err) {
      // Nao interrompe o lote: as demais lojas ainda devem ser renovadas.
      errors.push(`${doc.id}: ${String(err)}`);
      console.error(`[refresh-whatsapp-tokens] falha na loja ${doc.id}:`, err);
    }
  }

  return NextResponse.json({ total: snap.size, refreshed, skipped, errors });
}

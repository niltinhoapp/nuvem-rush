// Cron da Vercel: roda periodicamente, busca jobs agendados ja vencidos
// (runAt <= agora) em todas as lojas e dispara cada um.
// Protegido pelo CRON_SECRET que a Vercel injeta no header Authorization.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { dispatchJob } from "@/lib/dispatch";
import type { Job } from "@/types";

export const maxDuration = 60; // segundos

export async function GET(req: NextRequest) {
  // A Vercel envia "Authorization: Bearer <CRON_SECRET>" quando CRON_SECRET existe.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const now = Date.now();
  // Equality-only (status): usa indice automatico, sem indice composto.
  // Filtramos runAt em memoria. Limite por execucao para caber em 60s.
  const snap = await db
    .collectionGroup("jobs")
    .where("status", "==", "scheduled")
    .limit(200)
    .get();

  const due = snap.docs
    .map((d) => d.data() as Job)
    .filter((j) => j.runAt <= now);

  const results = await Promise.allSettled(
    due.map((j) => dispatchJob(j.storeId, j.jobId)),
  );

  const sent = results.filter(
    (r) => r.status === "fulfilled" && r.value.status === "sent",
  ).length;

  return NextResponse.json({ ok: true, scanned: snap.size, due: due.length, sent });
}

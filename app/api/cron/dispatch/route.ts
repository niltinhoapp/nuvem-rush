// Cron da Vercel: roda periodicamente, busca jobs agendados ja vencidos
// (runAt <= agora) e dispara cada um.
// Protegido pelo CRON_SECRET que a Vercel injeta no header Authorization.
//
// Itera as lojas ativas e consulta jobs por loja (equality em status, indice
// automatico). Os jobs sao ORDENADOS por runAt (mais antigos primeiro) e
// disparados com CONCORRENCIA LIMITADA, para nunca inanir jobs vencidos nem
// estourar o maxDuration / a Graph API num pico.
// Para escala (>500 jobs agendados por loja), migrar para collectionGroup
// + indice composto (status ASC, runAt ASC) e paginacao por runAt.
import { NextRequest, NextResponse } from "next/server";
import { db, col } from "@/lib/firebase/admin";
import { dispatchJob, recoverOrphanProcessingJobs } from "@/lib/dispatch";
import { isJobDue } from "@/lib/dispatch/claim";
import type { Job } from "@/types";

export const maxDuration = 60; // segundos

// Quantos jobs disparam ao mesmo tempo. Teto para nao estourar o tempo da
// funcao nem gerar pico contra a Graph API/Resend.
const CONCURRENCY = 10;
const PER_STORE_LIMIT = 1000;

export async function GET(req: NextRequest) {
  // Fail-closed: sem CRON_SECRET configurado, recusa (nao expoe o cron).
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const now = Date.now();
  const stores = await db.collection("stores").where("status", "==", "active").get();

  let scanned = 0;
  let recovered = 0;
  const due: Job[] = [];

  for (const store of stores.docs) {
    // Recupera jobs presos em "processing" (worker morto pos-claim) ANTES do
    // scan, para que voltem a "scheduled" e sejam disparados neste mesmo ciclo.
    recovered += await recoverOrphanProcessingJobs(store.id, now);

    const snap = await col(store.id, "jobs")
      .where("status", "==", "scheduled")
      .limit(PER_STORE_LIMIT)
      .get();
    scanned += snap.size;
    for (const d of snap.docs) {
      const job = d.data() as Job;
      if (isJobDue(job.runAt, now)) due.push(job);
    }
  }

  // Vencidos ha mais tempo disparam primeiro (evita inanicao dentro do lote).
  due.sort((a, b) => a.runAt - b.runAt);

  // Concorrencia limitada: processa em lotes de CONCURRENCY.
  let sent = 0;
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((j) => dispatchJob(j.storeId, j.jobId)),
    );
    sent += results.filter(
      (r) => r.status === "fulfilled" && r.value.status === "sent",
    ).length;
  }

  return NextResponse.json({ ok: true, stores: stores.size, scanned, recovered, due: due.length, sent });
}

import { NextRequest, NextResponse } from "next/server";
import { firestoreWebhookInboxRepository } from "@/lib/webhooks/inbox.firestore";
import { firestoreOrderWebhookProcessor } from "@/lib/webhooks/orderProcessor";
import { processWebhookInboxBatch } from "@/lib/webhooks/worker";
import { isWebhookInboxCronAuthorized } from "@/lib/webhooks/cronAuth";

export const maxDuration = 300;
const BATCH_SIZE = 5;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!isWebhookInboxCronAuthorized(secret, req.headers.get("authorization"))) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  try {
    const stats = await processWebhookInboxBatch({
      repository: firestoreWebhookInboxRepository,
      processor: firestoreOrderWebhookProcessor,
      batchSize: BATCH_SIZE,
    });
    return NextResponse.json({ ok: true, ...stats });
  } catch (error) {
    console.error("[webhook-inbox] worker failure", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "falha no worker" }, { status: 500 });
  }
}

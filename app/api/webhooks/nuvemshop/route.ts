// Receiver de webhooks. Responde 200 rapido; processamento pesado e assincrono.
// Valida HMAC, trata eventos LGPD na hora e enfileira pedidos para o motor.
import { NextRequest, NextResponse } from "next/server";
import { verifyHmac } from "@/lib/nuvemshop/webhooks";
import { db, col, storeRef } from "@/lib/firebase/admin";
import { handleOrderEvent } from "@/lib/rules/process";
import { eventKey } from "@/lib/webhooks/idempotency";
import { firestoreEventClaim } from "@/lib/webhooks/idempotency.firestore";
import { handleAppUninstalled } from "@/lib/lifecycle/uninstall";
import { lgpdEventSchema } from "@/lib/lgpd/model";
import { processCustomerRedact } from "@/lib/lgpd/customerRedact";
import { firestoreCustomerRedactRepository } from "@/lib/lgpd/firestore";
import { processStoreRedact } from "@/lib/lgpd/storeRedact";
import { firestoreStoreRedactRepository } from "@/lib/lgpd/storeRedact.firestore";
import {
  DATA_REQUEST_DELIVERY_STATUS,
  processDataRequest,
} from "@/lib/lgpd/dataRequest";
import { firestoreDataRequestRepository } from "@/lib/lgpd/dataRequest.firestore";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";

// Health check / verificacao de URL pelo painel da Nuvemshop (faz GET).
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-linkedstore-hmac-sha256");

  if (!verifyHmac(raw, signature)) {
    return NextResponse.json({ error: "assinatura invalida" }, { status: 401 });
  }

  let payload: {
    event: string;
    store_id: number;
    id?: number; // id do recurso (ex.: pedido)
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ error: "payload invalido" }, { status: 400 });
  }
  if (!payload || typeof payload.event !== "string" || payload.store_id == null) {
    return NextResponse.json({ error: "payload invalido" }, { status: 400 });
  }
  const storeId = String(payload.store_id);

  switch (payload.event) {
    // ---- LGPD / ciclo de vida ----
    case "app/uninstalled":
      await handleAppUninstalled(storeId);
      // Dados permanecem retidos. Purga/anonimizacao exige fluxo LGPD separado.
      break;

    case "store/redact": {
      const parsed = lgpdEventSchema.safeParse(payload);
      if (!parsed.success) {
        return NextResponse.json({ error: "payload LGPD invalido" }, { status: 400 });
      }
      try {
        const result = await processStoreRedact(
          firestoreStoreRedactRepository,
          parsed.data,
        );
        return NextResponse.json({ ok: true, completed: true, deduped: result.deduped });
      } catch {
        return NextResponse.json({ error: "falha ao processar LGPD" }, { status: 500 });
      }
    }

    case "customers/data_request": {
      const parsed = lgpdEventSchema.safeParse(payload);
      if (!parsed.success) {
        return NextResponse.json({ error: "payload LGPD invalido" }, { status: 400 });
      }
      try {
        const result = await processDataRequest(firestoreDataRequestRepository, parsed.data);
        return NextResponse.json({
          ok: true,
          compiled: true,
          deduped: result.deduped,
          delivery: DATA_REQUEST_DELIVERY_STATUS,
        });
      } catch {
        return NextResponse.json({ error: "falha ao processar LGPD" }, { status: 500 });
      }
    }

    case "customers/redact": {
      const parsed = lgpdEventSchema.safeParse(payload);
      if (!parsed.success || !parsed.data.customer) {
        return NextResponse.json({ error: "payload LGPD invalido" }, { status: 400 });
      }
      try {
        const result = await processCustomerRedact(
          firestoreCustomerRedactRepository,
          parsed.data,
        );
        return NextResponse.json({ ok: true, completed: true, deduped: result.deduped });
      } catch {
        return NextResponse.json({ error: "falha ao processar LGPD" }, { status: 500 });
      }
    }

    /* app/uninstalled continua no fluxo validado acima. Data request compila
       somente em memoria; delivery ocorre sob demanda no dashboard Nexo. */

    // ---- Pedidos -> motor de regras ----
    case "order/paid":
    case "order/created":
    case "order/fulfilled":
    case "order/cancelled": {
      // order/fulfilled: pedido enviado -> sincroniza rastreio e dispara
      // fluxos com gatilho "pedido enviado" (ex.: rastreio no WhatsApp).
      // order/cancelled: cancela enrollments/jobs pendentes desse pedido.
      //
      // Idempotencia (B2): a Nuvemshop reentrega webhooks. Sem dedup, cada
      // reentrega de order/paid criava enrollments/jobs duplicados -> mensagens
      // em dobro. Reivindica o evento de forma ATOMICA (create-if-not-exists);
      // duplicata (inclusive concorrente) vira no-op. Se o processamento falhar,
      // libera a reivindicacao e responde 500 para a Nuvemshop reentregar.
      if (payload.id == null) {
        return NextResponse.json({ error: "evento de pedido sem id" }, { status: 400 });
      }
      const key = eventKey(payload.event, payload.id);
      const first = await firestoreEventClaim.claim(storeId, key);
      if (!first) {
        return NextResponse.json({ ok: true, deduped: true });
      }
      try {
        await handleOrderEvent(storeId, String(payload.id), payload.event);
      } catch (err) {
        await firestoreEventClaim.release(storeId, key);
        console.error("[webhook nuvemshop] falha ao processar", key, err);
        return NextResponse.json({ error: "falha ao processar" }, { status: 500 });
      }
      break;
    }

    default:
      await db.runTransaction(async (tx) => {
        const store = await tx.get(storeRef(storeId));
        if (!isStoreCommerciallyActive(store.data()?.status)) return;
        tx.create(col(storeId, "logs").doc(), {
          type: "webhook_unhandled",
          event: payload.event,
          at: Date.now(),
        });
      });
  }

  return NextResponse.json({ ok: true });
}

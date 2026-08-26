// Receiver de webhooks. Eventos de pedido sao persistidos em inbox duravel
// antes do 2xx; processamento comercial ocorre em worker separado.
import { NextRequest, NextResponse } from "next/server";
import { db, col, storeRef } from "@/lib/firebase/admin";
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
import { parseSignedWebhookRequest } from "@/lib/webhooks/request";
import {
  ingestOrderWebhook,
  isOrderWebhookEvent,
} from "@/lib/webhooks/inbox";
import { firestoreWebhookInboxRepository } from "@/lib/webhooks/inbox.firestore";
import { syncCommercialState, setBillingSuspended } from "@/lib/billing/sync.firestore";

// Health check / verificacao de URL pelo painel da Nuvemshop (faz GET).
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-linkedstore-hmac-sha256");
  const parsed = parseSignedWebhookRequest(raw, signature);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.payload;
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

    // ---- Billing V1 (Nuvemshop nativo) ----
    // subscription/updated: payload e so um SINAL (concept_code/service_id/
    // event_launch_ts) — nunca a fonte do estado. Sempre rebusca a Nuvemshop.
    // Naturalmente idempotente: reprocessar o mesmo evento so refaz a mesma
    // consulta e grava o mesmo resultado (sem ledger de dedup necessario).
    // store_id ja foi validado por parseSignedWebhookRequest acima; loja
    // inexistente/inativa e tratada dentro do proprio syncCommercialState
    // (fail-closed, sem side-effect fora do tenant).
    case "subscription/updated":
      await syncCommercialState(storeId);
      break;

    // app/suspended e app/resumed: sinal DOCUMENTADO de suspensao por falta de
    // pagamento (nao dispara para o esgotamento dos dias gratis). So altera a
    // flag local; o proximo sync (aqui mesmo, em seguida) recalcula o estado
    // combinando isso com o resultado real da Nuvemshop.
    case "app/suspended":
      await setBillingSuspended(storeId, true);
      await syncCommercialState(storeId);
      break;

    case "app/resumed":
      await setBillingSuspended(storeId, false);
      await syncCommercialState(storeId);
      break;

    // ---- Pedidos -> motor de regras ----
    case "order/paid":
    case "order/created":
    case "order/fulfilled":
    case "order/cancelled": {
      // order/fulfilled: pedido enviado -> sincroniza rastreio e dispara
      // fluxos com gatilho "pedido enviado" (ex.: rastreio no WhatsApp).
      // order/cancelled: cancela enrollments/jobs pendentes desse pedido.
      //
      // O request termina depois da persistencia tenant-scoped. Nenhuma API
      // externa, sincronizacao ou criacao de efeitos comerciais ocorre aqui.
      if (
        !isOrderWebhookEvent(payload.event)
        || (typeof payload.id !== "string" && typeof payload.id !== "number")
        || String(payload.id).trim().length === 0
      ) {
        return NextResponse.json({ error: "evento de pedido sem id" }, { status: 400 });
      }
      const result = await ingestOrderWebhook(firestoreWebhookInboxRepository, {
        storeId,
        event: payload.event,
        resourceId: String(payload.id),
      });
      return NextResponse.json(result.body, { status: result.httpStatus });
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

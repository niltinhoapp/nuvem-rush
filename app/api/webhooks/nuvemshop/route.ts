// Receiver de webhooks. Responde 200 rapido; processamento pesado e assincrono.
// Valida HMAC, trata eventos LGPD na hora e enfileira pedidos para o motor.
import { NextRequest, NextResponse } from "next/server";
import { verifyHmac } from "@/lib/nuvemshop/webhooks";
import { storeRef, col } from "@/lib/firebase/admin";
import { handleOrderEvent } from "@/lib/rules/process";
import { eventKey } from "@/lib/webhooks/idempotency";
import { firestoreEventClaim } from "@/lib/webhooks/idempotency.firestore";

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

  const payload = JSON.parse(raw) as {
    event: string;
    store_id: number;
    id?: number; // id do recurso (ex.: pedido)
  };
  const storeId = String(payload.store_id);

  switch (payload.event) {
    // ---- LGPD / ciclo de vida ----
    case "app/uninstalled":
      await storeRef(storeId).set({ status: "uninstalled" }, { merge: true });
      // TODO: agendar purga completa dos dados da loja.
      break;

    case "store/redact":
    case "customers/redact":
      // LGPD: registra a solicitacao de remocao para processamento.
      // TODO: remover/anonimizar dados pessoais conforme o payload.
      await col(storeId, "lgpd_requests").add({
        type: payload.event, payload, status: "pending", at: Date.now(),
      });
      break;

    case "customers/data_request":
      // LGPD: titular solicitou os dados que mantemos sobre ele.
      // TODO: compilar e disponibilizar os dados do cliente referenciado.
      await col(storeId, "lgpd_requests").add({
        type: payload.event, payload, status: "pending", at: Date.now(),
      });
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
      await col(storeId, "logs").add({
        type: "webhook_unhandled",
        event: payload.event,
        at: Date.now(),
      });
  }

  return NextResponse.json({ ok: true });
}

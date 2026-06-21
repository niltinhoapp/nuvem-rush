// Receiver de webhooks. Responde 200 rapido; processamento pesado e assincrono.
// Valida HMAC, trata eventos LGPD na hora e enfileira pedidos para o motor.
import { NextRequest, NextResponse } from "next/server";
import { verifyHmac } from "@/lib/nuvemshop/webhooks";
import { storeRef, col } from "@/lib/firebase/admin";
import { handleOrderEvent } from "@/lib/rules/process";

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
      // Em producao: publicar em Pub/Sub e retornar. Aqui chamamos direto.
      // Sincroniza o pedido da API + roda o motor de regras.
      await handleOrderEvent(storeId, String(payload.id), payload.event);
      break;

    case "order/cancelled":
      // TODO: cancelar jobs pendentes vinculados a este pedido.
      break;

    default:
      await col(storeId, "logs").add({
        type: "webhook_unhandled",
        event: payload.event,
        at: Date.now(),
      });
  }

  return NextResponse.json({ ok: true });
}

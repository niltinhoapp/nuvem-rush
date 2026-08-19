// OAuth callback: a Nuvemshop redireciona para ca com ?code=...
// Trocamos o code por access_token, criamos a loja e registramos webhooks.
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/nuvemshop/oauth";
import { NuvemshopClient } from "@/lib/nuvemshop/client";
import { REQUIRED_WEBHOOK_EVENTS } from "@/lib/nuvemshop/webhooks";
import { storeRef } from "@/lib/firebase/admin";
import { buildStoreInstallData } from "@/lib/nuvemshop/store-install";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "code ausente" }, { status: 400 });
  }

  try {
    const token = await exchangeCodeForToken(code);
    const storeId = String(token.user_id);
    const ref = storeRef(storeId);
    const existingStore = await ref.get();

    // TODO: criptografar accessToken em repouso (KMS) antes de persistir.
    await ref.set(
      buildStoreInstallData(
        storeId,
        { accessToken: token.access_token, scope: token.scope },
        existingStore.exists,
      ),
      { merge: true },
    );

    // Registra os webhooks obrigatorios apontando para o nosso receiver.
    const client = new NuvemshopClient(storeId, token.access_token);
    const webhookUrl = `${process.env.APP_BASE_URL}/api/webhooks/nuvemshop`;
    await Promise.allSettled(
      REQUIRED_WEBHOOK_EVENTS.map((event) => client.createWebhook(event, webhookUrl)),
    );

    // Redireciona o lojista de volta para o admin (app incorporado).
    // Pagina de sucesso simples (nao o /dashboard embarcado, que espera o Nexo
    // do admin e trava quando a instalacao ocorre fora do iframe).
    return NextResponse.redirect(`${process.env.APP_BASE_URL}/instalado`);
  } catch (err) {
    console.error("Erro no callback OAuth:", err);
    return NextResponse.json({ error: "falha na instalacao" }, { status: 500 });
  }
}

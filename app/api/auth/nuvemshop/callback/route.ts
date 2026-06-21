// OAuth callback: a Nuvemshop redireciona para ca com ?code=...
// Trocamos o code por access_token, criamos a loja e registramos webhooks.
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/nuvemshop/oauth";
import { NuvemshopClient } from "@/lib/nuvemshop/client";
import { REQUIRED_WEBHOOK_EVENTS } from "@/lib/nuvemshop/webhooks";
import { storeRef } from "@/lib/firebase/admin";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "code ausente" }, { status: 400 });
  }

  try {
    const token = await exchangeCodeForToken(code);
    const storeId = String(token.user_id);

    // TODO: criptografar accessToken em repouso (KMS) antes de persistir.
    await storeRef(storeId).set(
      {
        storeId,
        accessToken: token.access_token,
        scope: token.scope,
        plan: "free",
        status: "active",
        installedAt: Date.now(),
        quotas: {
          contactsLimit: 250,
          dispatchesMonthLimit: 500,
          dispatchesMonthUsed: 0,
        },
      },
      { merge: true },
    );

    // Registra os webhooks obrigatorios apontando para o nosso receiver.
    const client = new NuvemshopClient(storeId, token.access_token);
    const webhookUrl = `${process.env.APP_BASE_URL}/api/webhooks/nuvemshop`;
    await Promise.allSettled(
      REQUIRED_WEBHOOK_EVENTS.map((event) => client.createWebhook(event, webhookUrl)),
    );

    // Redireciona o lojista de volta para o admin (app incorporado).
    return NextResponse.redirect(`${process.env.APP_BASE_URL}/dashboard?installed=1`);
  } catch (err) {
    console.error("Erro no callback OAuth:", err);
    return NextResponse.json({ error: "falha na instalacao" }, { status: 500 });
  }
}

// POST /api/whatsapp/connect
// Finaliza o Embedded Signup: recebe { code, wabaId, phoneNumberId } vindos
// do popup da Meta, troca o code pelo business token DO LOJISTA, inscreve
// nosso app na WABA dele, cria o template padrao e salva tudo na loja.
//
// GET /api/whatsapp/connect -> status da conexao (para a UI).
import { NextRequest, NextResponse } from "next/server";
import { resolveStoreId } from "@/lib/auth/session";
import { storeRef } from "@/lib/firebase/admin";
import {
  exchangeCodeForToken,
  subscribeAppToWaba,
  createDefaultTemplate,
  DEFAULT_TEMPLATE_NAME,
  DEFAULT_TEMPLATE_LANG,
} from "@/lib/whatsapp/embedded";
import type { Store, StoreWhatsapp } from "@/types";

export async function GET(req: NextRequest) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  const wa = store?.whatsapp;
  return NextResponse.json({
    connected: wa?.status === "connected",
    phoneNumberId: wa?.phoneNumberId ?? null,
    templateName: wa?.templateName ?? null,
  });
}

export async function POST(req: NextRequest) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    wabaId?: string;
    phoneNumberId?: string;
  } | null;
  if (!body?.code || !body.wabaId || !body.phoneNumberId) {
    return NextResponse.json(
      { error: "payload invalido (code, wabaId, phoneNumberId obrigatorios)" },
      { status: 400 },
    );
  }

  try {
    // 1. code -> business token do lojista (longa duracao).
    const accessToken = await exchangeCodeForToken(body.code);

    // 2. Inscreve nosso app na WABA dele (webhooks de status/template).
    await subscribeAppToWaba(body.wabaId, accessToken);

    // 3. Template padrao de pos-venda na conta DELE (best effort: se falhar,
    //    a conexao vale mesmo assim e o lojista cria depois pela UI da Meta).
    let templateOk = false;
    try {
      await createDefaultTemplate(body.wabaId, accessToken);
      templateOk = true;
    } catch (err) {
      console.warn(`[whatsapp connect] template nao criado (${storeId}):`, err);
    }

    const whatsapp: StoreWhatsapp = {
      wabaId: body.wabaId,
      phoneNumberId: body.phoneNumberId,
      accessToken, // TODO: criptografar em repouso (KMS)
      status: "connected",
      ...(templateOk
        ? { templateName: DEFAULT_TEMPLATE_NAME, templateLang: DEFAULT_TEMPLATE_LANG }
        : {}),
      connectedAt: Date.now(),
    };
    await storeRef(storeId).update({ whatsapp });

    return NextResponse.json({ connected: true, templateCreated: templateOk });
  } catch (err) {
    console.error(`[whatsapp connect] falha (${storeId}):`, err);
    return NextResponse.json(
      { error: "falha ao conectar WhatsApp", detail: String(err) },
      { status: 502 },
    );
  }
}

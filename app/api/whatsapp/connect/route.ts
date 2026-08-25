// POST /api/whatsapp/connect
// Finaliza o Embedded Signup: recebe { code, wabaId, phoneNumberId } vindos
// do popup da Meta, troca o code pelo business token DO LOJISTA, inscreve
// nosso app na WABA dele, cria o template padrao e salva tudo na loja.
//
// GET /api/whatsapp/connect -> status da conexao (para a UI).
import { NextRequest, NextResponse } from "next/server";
import { resolveStoreId } from "@/lib/auth/session";
import { db, storeRef } from "@/lib/firebase/admin";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import {
  exchangeCodeForToken,
  subscribeAppToWaba,
  registerPhoneNumber,
  createDefaultTemplate,
  getDefaultTemplateStatus,
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
    templateStatus: wa?.templateStatus ?? null,
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
    const initialStore = await storeRef(storeId).get();
    if (!isStoreCommerciallyActive(initialStore.data()?.status)) {
      return NextResponse.json({ error: "loja inativa" }, { status: 409 });
    }

    // 1. code -> business token do lojista (longa duracao).
    const accessToken = await exchangeCodeForToken(body.code);

    // 2. Inscreve nosso app na WABA dele (webhooks de status/template).
    await subscribeAppToWaba(body.wabaId, accessToken);

    // 2.1. Registra o numero na Cloud API (necessario para numeros novos;
    // numeros ja em coexistencia retornam "already registered", tratado como
    // ok). Best effort: se falhar por outro motivo, a conexao ainda vale —
    // o lojista pode registrar manualmente pelo WhatsApp Manager depois.
    try {
      await registerPhoneNumber(body.phoneNumberId, accessToken);
    } catch (err) {
      console.warn("[whatsapp connect] phone registration failed", {
        storeId,
        errorName: err instanceof Error ? err.name : "unknown",
      });
    }

    // 3. Template padrao de pos-venda na conta DELE (best effort: se falhar,
    //    a conexao vale mesmo assim e o lojista cria depois pela UI da Meta).
    let templateOk = false;
    let templateStatus: StoreWhatsapp["templateStatus"];
    try {
      const created = await createDefaultTemplate(body.wabaId, accessToken);
      templateOk = true;
      templateStatus = created.status;
      if (created.alreadyExisted) {
        try {
          // Reconexao nao pressupoe aprovacao: so libera o envio se a leitura
          // atual da Meta confirmar explicitamente APPROVED.
          templateStatus = await getDefaultTemplateStatus(body.wabaId, accessToken);
        } catch (err) {
          console.warn("[whatsapp connect] template status lookup failed", {
            storeId,
            errorName: err instanceof Error ? err.name : "unknown",
          });
        }
      }
    } catch (err) {
      console.warn("[whatsapp connect] template creation failed", {
        storeId,
        errorName: err instanceof Error ? err.name : "unknown",
      });
    }

    const whatsapp: StoreWhatsapp = {
      wabaId: body.wabaId,
      phoneNumberId: body.phoneNumberId,
      accessToken, // TODO: criptografar em repouso (KMS)
      status: "connected",
      ...(templateOk
        ? {
          templateName: DEFAULT_TEMPLATE_NAME,
          templateLang: DEFAULT_TEMPLATE_LANG,
          ...(templateStatus
            ? { templateStatus, templateStatusUpdatedAt: Date.now() }
            : {}),
        }
        : {}),
      connectedAt: Date.now(),
      tokenRefreshedAt: Date.now(),
    };
    await db.runTransaction(async (tx) => {
      const ref = storeRef(storeId);
      const current = await tx.get(ref);
      if (!isStoreCommerciallyActive(current.data()?.status)) {
        throw new Error("store_inactive");
      }
      tx.update(ref, { whatsapp });
    });

    return NextResponse.json({
      connected: true,
      templateCreated: templateOk,
      templateStatus: templateStatus ?? null,
    });
  } catch (err) {
    console.error("[whatsapp connect] failed", {
      storeId,
      errorName: err instanceof Error ? err.name : "unknown",
    });
    return NextResponse.json(
      { error: "falha ao conectar WhatsApp" },
      { status: 502 },
    );
  }
}

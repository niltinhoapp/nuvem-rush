// Webhook do WhatsApp (Meta Cloud API).
//
// GET  -> verificacao do webhook (handshake com hub.challenge).
// POST -> recebe eventos. Trata:
//   - Opt-out: cliente responde SAIR/PARAR/etc -> marca contact.optOut = true
//     (o template promete isso; sem tratar, viola politica da Meta e LGPD).
//
// Seguranca: valida a assinatura HMAC-SHA256 (X-Hub-Signature-256) com o
// META_APP_SECRET — sem isso, qualquer um forjaria eventos (ex.: opt-out em
// massa). Mesmo padrao do webhook da Nuvemshop.
//
// Env: WHATSAPP_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET.
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, col } from "@/lib/firebase/admin";
import {
  parseMetaTemplateStatusUpdate,
} from "@/lib/whatsapp/templateStatus";
import { updateTemplateStatus } from "@/lib/whatsapp/templateStatus.firestore";
import type { Contact } from "@/types";

const OPT_OUT_WORDS = ["sair", "parar", "cancelar", "descadastrar", "stop", "pare"];

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "verificacao invalida" }, { status: 403 });
}

// Valida X-Hub-Signature-256 (sha256=<hmac do corpo cru com META_APP_SECRET>).
function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = header.slice("sha256=".length);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Assinatura invalida -> ignora (mas responde 200 para a Meta nao desativar
  // o webhook por erros repetidos).
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    console.warn("[whatsapp webhook] invalid signature");
    return NextResponse.json({ received: true });
  }

  try {
    const body = JSON.parse(raw);
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const templateUpdate = parseMetaTemplateStatusUpdate(entry, change);
        if (templateUpdate) {
          console.info("[whatsapp webhook] template status event received", {
            wabaId: templateUpdate.wabaId,
            templateName: templateUpdate.name,
            language: templateUpdate.language,
            status: templateUpdate.status,
          });
          const result = await updateTemplateStatus(templateUpdate);
          console.info("[whatsapp webhook] template status event processed", {
            wabaId: templateUpdate.wabaId,
            templateName: templateUpdate.name,
            result,
          });
          continue;
        }
        const value = change?.value;
        const phoneNumberId = value?.metadata?.phone_number_id as string | undefined;
        const messages = value?.messages as Array<{ from?: string; text?: { body?: string } }> | undefined;
        if (!phoneNumberId || !messages?.length) continue;

        // Descobre a loja dona deste numero.
        const storeSnap = await db
          .collection("stores")
          .where("whatsapp.phoneNumberId", "==", phoneNumberId)
          .limit(1)
          .get();
        if (storeSnap.empty) continue;
        const storeId = storeSnap.docs[0]!.id;

        for (const msg of messages) {
          const text = msg.text?.body?.trim().toLowerCase();
          const from = msg.from ? onlyDigits(msg.from) : "";
          if (!text || !from) continue;
          if (!OPT_OUT_WORDS.includes(text)) continue;

          await markOptOut(storeId, from);
        }
      }
    }
  } catch (error) {
    console.error("[whatsapp webhook] processing failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }

  return NextResponse.json({ received: true });
}

// Marca opt-out no contato cujo telefone bate com `fromDigits`. Compara pelos
// ultimos 8 digitos (ignora DDI/9 extra) para tolerar formatos diferentes.
async function markOptOut(storeId: string, fromDigits: string): Promise<void> {
  const tail = fromDigits.slice(-8);
  const contacts = await col(storeId, "contacts").get();
  for (const doc of contacts.docs) {
    const c = doc.data() as Contact;
    const phoneDigits = c.phone ? onlyDigits(c.phone) : "";
    if (phoneDigits && phoneDigits.slice(-8) === tail) {
      await doc.ref.update({ optOut: true });
    }
  }
}

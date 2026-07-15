// Geracao de conteudo (e-mails, sequencias, cross-sell) via OpenAI.
import OpenAI from "openai";

// Inicializacao preguiçosa (nao quebra o load se a key nao estiver setada).
let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY nao configurada");
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export async function generateEmailContent(
  prompt: string,
  context: Record<string, unknown>,
): Promise<{ subject: string; html: string }> {
  const completion = await client().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Voce e um copywriter de e-mail marketing pos-venda para e-commerce. " +
          "Responda SEMPRE em JSON {\"subject\": string, \"html\": string}. " +
          "Tom amigavel, PT-BR, com call-to-action claro.",
      },
      {
        role: "user",
        content: `Contexto: ${JSON.stringify(context)}\nObjetivo do e-mail: ${prompt}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(completion.choices[0]?.message.content ?? "{}");
}

// Gera o texto de UMA variavel de corpo de template do WhatsApp (texto puro,
// sem HTML/markdown, curto o bastante para caber numa mensagem de WhatsApp).
export async function generateWhatsappContent(
  prompt: string,
  context: Record<string, unknown>,
): Promise<string> {
  const completion = await client().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Voce e um copywriter de pos-venda para e-commerce escrevendo uma " +
          "mensagem curta de WhatsApp (texto puro, sem markdown, sem HTML, " +
          "no maximo 2-3 frases). Responda APENAS com o texto da mensagem, " +
          "em PT-BR, tom amigavel.",
      },
      {
        role: "user",
        content: `Contexto: ${JSON.stringify(context)}\nObjetivo da mensagem: ${prompt}`,
      },
    ],
  });

  return (completion.choices[0]?.message.content ?? "").trim();
}

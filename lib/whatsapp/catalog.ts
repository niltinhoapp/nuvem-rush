export const WHATSAPP_TEMPLATE_CATALOG = {
  carrinho_abandonado: {
    key: "carrinho_abandonado", label: "Carrinho abandonado", name: "carrinho_abandonado", language: "pt_BR", category: "MARKETING", event: "cart_abandoned",
    body: "Olá {{1}}! Você deixou itens no seu carrinho.\nPara continuar sua compra, acesse: {{2}}\nSe não quiser receber mensagens como esta, responda SAIR.",
    example: ["Maria", "https://loja.exemplo/carrinho"],
  },
  pedido_pagamento_confirmado: {
    key: "pedido_pagamento_confirmado", label: "Pagamento confirmado", name: "pedido_pagamento_confirmado", language: "pt_BR", category: "UTILITY", event: "order_paid",
    body: "Olá {{1}}! O pagamento do seu pedido {{2}} foi confirmado.", example: ["Maria", "1234"],
  },
  pedido_enviado_rastreio: {
    key: "pedido_enviado_rastreio", label: "Pedido enviado", name: "pedido_enviado_rastreio", language: "pt_BR", category: "UTILITY", event: "order_fulfilled",
    body: "Olá {{1}}! Seu pedido {{2}} foi enviado.\nAcompanhe a entrega: {{3}}", example: ["Maria", "1234", "https://loja.exemplo/rastreio"],
  },
  pos_venda_agradecimento: {
    key: "pos_venda_agradecimento", label: "Pós-venda", name: "pos_venda_agradecimento", language: "pt_BR", category: "UTILITY",
    body: "Olá {{1}}! Obrigado pela sua compra.\nEsperamos que tenha uma ótima experiência com seu pedido.", example: ["Maria"],
  },
} as const;

export type TemplateCatalogKey = keyof typeof WHATSAPP_TEMPLATE_CATALOG;
export type TemplateCatalogEntry = (typeof WHATSAPP_TEMPLATE_CATALOG)[TemplateCatalogKey];
export const WHATSAPP_TEMPLATE_CATALOG_KEYS = Object.keys(WHATSAPP_TEMPLATE_CATALOG) as TemplateCatalogKey[];
export function getCatalogTemplate(key: TemplateCatalogKey): TemplateCatalogEntry { return WHATSAPP_TEMPLATE_CATALOG[key]; }
export function isTemplateCatalogKey(value: unknown): value is TemplateCatalogKey { return typeof value === "string" && value in WHATSAPP_TEMPLATE_CATALOG; }
export function findCatalogTemplateByIdentity(name: string, language: string): TemplateCatalogEntry | undefined {
  return WHATSAPP_TEMPLATE_CATALOG_KEYS.map(getCatalogTemplate).find((template) => template.name === name && template.language === language);
}
export function catalogTemplateForEvent(event: string): TemplateCatalogEntry | undefined {
  return WHATSAPP_TEMPLATE_CATALOG_KEYS.map(getCatalogTemplate).find(
    (template) => "event" in template && template.event === event,
  );
}

# Embedded Signup — WhatsApp por lojista (modelo Tech Provider)

Cada lojista conecta a **própria** conta de WhatsApp Business dentro do app.
A Meta cobra as mensagens direto do lojista → custo zero de tráfego pro
Nuvem Rush. O código já está pronto; o que falta é liberação da Meta.

## O que o código já faz

- `app/connect-whatsapp/page.tsx` — página que o lojista abre (nova aba) com o
  botão "Conectar com a Meta" (popup oficial do Embedded Signup).
- `app/api/whatsapp/connect/route.ts` — troca o code pelo token do lojista,
  inscreve nosso app na WABA dele (webhooks) e cria o template
  `pos_venda_agradecimento` na conta dele automaticamente.
- `lib/whatsapp/embedded.ts` — funções da Graph API.
- `lib/channels/whatsapp.ts` — envio usa o número/token **da loja**; se a loja
  não conectou, cai no número global (env vars).
- `types/index.ts` — `Store.whatsapp` (wabaId, phoneNumberId, accessToken...).

## Checklist na Meta (fazer em ordem)

1. **Resolver o bloqueio 2494160** (em andamento: caso 36962071840104512 +
   fórum). Sem isso nem a nossa conta cria template.
2. **Virar Provedor de Tecnologia**: painel do app → fluxo "Torne-se um
   Provedor de Tecnologia". Etapa 1 (verificação da empresa) ✅ concluída;
   falta a etapa 2 (análise do app).
3. **App Review (Acesso Avançado)** para as permissões:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - (`business_management` se o painel exigir)
   É preciso mostrar o app funcionando (screencast do fluxo de conexão —
   a página /connect-whatsapp serve pra isso).
4. **Criar a Configuration do Embedded Signup**: painel do app → Login do
   Facebook para Empresas → Configurações → criar configuração do tipo
   "Cadastro incorporado do WhatsApp" → copiar o **Configuration ID**.
5. **Publicar o app** (modo Ativo/Live).
6. **Env vars no Vercel**: `META_APP_SECRET` (painel → Configurações →
   Básico → Chave Secreta do App) e `NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID`
   (passo 4). `NEXT_PUBLIC_META_APP_ID` já é conhecido (908269564938670).
7. **Testar**: abrir /connect-whatsapp com uma conta de teste, conectar um
   número, conferir `Store.whatsapp` no Firestore e o template criado na
   WABA de teste.

## Depois que funcionar

- Adicionar o botão "Conectar WhatsApp" no dashboard (abre a página em nova
  aba com o session token na query).
- Criptografar `Store.whatsapp.accessToken` em repouso (KMS), junto com o
  accessToken da Nuvemshop.
- Tratar `message_template_status_update` no webhook para marcar o template
  como aprovado/rejeitado por loja.
- Remover o endpoint temporário `api/admin/create-whatsapp-template`.

## Custos (por que esse modelo)

- Sem Embedded Signup: todas as mensagens saem do nosso número → pagamos
  ~R$0,33/msg de marketing e repassamos via planos (margem apertada).
- Com Embedded Signup: o lojista paga a Meta direto. Nossas cotas de plano
  continuam valendo como limite de uso do app, mas viram margem pura.

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
2. ✅ **Virar Provedor de Tecnologia** — confirmado em 17/07/2026 (decisão
   irreversível aceita no painel). Novo checklist do painel: Login do
   Facebook para Empresas ✅ / requisitos de teste / verificação da empresa
   e do acesso / análise do app.
3. ✅ **Configuration do Embedded Signup criada** (17/07/2026, a partir do
   modelo "Cadastro incorporado do WhatsApp"):
   - **Configuration ID: 1561577032141885**
   - Token: usuário do sistema, expira em **60 dias** (único formato que o
     modelo oferece; a criação manual não lista WhatsApp como ativo).
     → ✅ resolvido no código: o cron diário
     `/api/cron/refresh-whatsapp-tokens` (vercel.json, 07:30 UTC) renova via
     `fb_exchange_token` todo token com mais de 30 dias.
   - Tarefas concedidas na WABA do lojista: manage, develop,
     manage_templates, manage_phone_assets, view_templates, view_phone_assets.
4. **App Review (Acesso Avançado)** para as permissões:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - (`business_management` se o painel exigir)
   É preciso mostrar o app funcionando (screencast do fluxo de conexão —
   a página /connect-whatsapp serve pra isso).
5. 🕐 **Verificação de acesso** — formulário ENVIADO em 17/07/2026 (status
   "Em análise"; Meta responde em até 5 dias). Respostas: Plataforma de SaaS;
   descrição do serviço de pós-venda; não gerencia portfólios de terceiros;
   site https://nuvem-rush.vercel.app.
6. **Publicar o app** (modo Ativo/Live).
7. **Env vars no Vercel**: `META_APP_SECRET` (painel → Configurações →
   Básico → Chave Secreta do App), `NEXT_PUBLIC_META_APP_ID=908269564938670`
   e `NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID=1561577032141885`.
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

# Especificação da conta demo de homologação

A conta deve reproduzir a jornada real sem credenciais no Git.

## Preparação manual

- [ ] Criar/selecionar loja demo Nuvemshop exclusiva.
- [ ] Autorizar App ID 34663 na loja.
- [ ] Garantir plano/trial liberado durante toda a janela de homologação.
- [ ] Remover bloqueios de pagamento, aprovação manual e onboarding interno.
- [ ] Criar produto, cliente e pedido totalmente fictícios.
- [ ] Preparar checkout abandonado fictício, se o cenário puder ser disparado de forma controlada.
- [ ] Preparar conta WhatsApp Business e número de teste consentido.
- [ ] Garantir modelo Meta necessário aprovado antes da gravação/revisão.
- [ ] Preparar caixa de e-mail de teste.
- [ ] Compartilhar credenciais somente pelo canal seguro solicitado pela Nuvemshop.
- [ ] Informar instruções, URLs e limitações conhecidas no pedido de homologação.

## Capacidades obrigatórias

O avaliador deve conseguir instalar pela URL oficial, abrir o painel incorporado, ver estado vazio, conectar WhatsApp, criar/salvar/ativar fluxo, gerar evento demo, confirmar e-mail/WhatsApp/log, reabrir como loja existente, desinstalar e reinstalar.

## Critérios anti-bloqueio

- Sem cartão obrigatório.
- Sem trial expirado.
- Sem espera humana.
- Sem dados de clientes reais.
- Sem dependência de aprovação durante o teste.
- Sem segredo exposto em URL, documento ou gravação.
- Janela de disponibilidade alinhada ao cron/agendador real.
- Plano com cota suficiente para repetir os testes.

## Registro

Para cada passo: data/hora, executor, resultado, screenshot/vídeo, identificador fictício e incidente. A conta só está pronta após ensaio completo de instalação → uso → remoção → reinstalação.

# Checklist de responsividade no iframe

Status estático: **VERMELHO até teste visual**.

## Viewports mínimos

- 1440x900 (Admin desktop amplo)
- 1280x800 (desktop comum)
- 1024x768 (tablet landscape/iframe reduzido)
- 768x1024 (tablet portrait)
- 390x844 (mobile, quando o Admin permitir)
- largura interna adicional: 600px para simular sidebar/iframe estreito

## Checklist

- [ ] Nenhum overflow horizontal no dashboard.
- [ ] Header e botões quebram/empilham sem corte.
- [ ] Card WhatsApp empilha conteúdo e ações.
- [ ] Campo de telefone + botão não saem do card.
- [ ] Lista de fluxos mantém nome, status e editar acessíveis.
- [ ] Toolbar do FlowBuilder empilha e preserva ação primária.
- [ ] Canvas não cria double scroll.
- [ ] Altura `80vh` funciona sem esconder conteúdo/rodapé do Admin.
- [ ] Nós de 340/360px continuam utilizáveis em largura estreita.
- [ ] Zoom/controles do React Flow funcionam por teclado e toque.
- [ ] Modais/drawers futuros ficam contidos no iframe.
- [ ] Foco não fica preso ou invisível.
- [ ] Loading/erro/vazio não saltam layout.
- [ ] Testar zoom do navegador em 200%.

## Riscos encontrados

- Flex rows sem `flexWrap` no dashboard e toolbar.
- Toolbar com vários controles em uma única linha.
- Nós fixos de 340/360px.
- `height="80vh"` dentro do iframe pode provocar double scroll.
- Página do editor tem padding inline e loading fora de Nimbus.
- Não há evidência de testes reais ou screenshots nos viewports.

Critério de aprovação: registrar screenshot e resultado para cada viewport, inclusive estado vazio, erro, fluxo existente e editor.

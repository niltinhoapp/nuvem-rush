export const metadata = { title: "Termos de Uso — Nuvem Rush" };

const wrap: React.CSSProperties = {
  fontFamily: "system-ui",
  maxWidth: 760,
  margin: "0 auto",
  padding: "3rem 1.5rem",
  lineHeight: 1.6,
  color: "#1a1a1a",
};

export default function TermosPage() {
  return (
    <main style={wrap}>
      <h1>Termos de Uso — Nuvem Rush</h1>
      <p>
        <em>Última atualização: 12 de agosto de 2026.</em>
      </p>

      <p>
        Estes Termos de Uso regulam o acesso ao Nuvem Rush, aplicativo de
        automação de pós-venda integrado à Nuvemshop. Ao instalar e utilizar o
        aplicativo, a loja declara que leu e concorda com estes termos.
      </p>

      <h2>1. Funcionamento do serviço</h2>
      <p>
        O Nuvem Rush permite que a loja configure fluxos automáticos associados
        a eventos e dados da sua operação na Nuvemshop. As ações disponíveis
        podem incluir comunicações por e-mail e WhatsApp e outras integrações
        exibidas no próprio aplicativo.
      </p>

      <h2>2. Responsabilidades da loja</h2>
      <p>A loja é responsável por:</p>
      <ul>
        <li>configurar, revisar, testar e ativar seus próprios fluxos;</li>
        <li>
          utilizar dados e canais de comunicação de forma lícita e respeitar
          consentimentos, preferências e direitos de seus clientes;
        </li>
        <li>
          manter corretas e protegidas as contas e integrações de terceiros que
          conectar ao aplicativo;
        </li>
        <li>
          verificar o conteúdo, os destinatários e o momento das comunicações
          antes de ativar uma automação.
        </li>
      </ul>

      <h2>3. Serviços de terceiros</h2>
      <p>
        O funcionamento pode depender de serviços da Nuvemshop e de provedores
        conectados pela loja, como hospedagem, armazenamento, e-mail e
        WhatsApp. Esses serviços possuem regras, limites e disponibilidade
        próprios. A loja também deve cumprir os termos aplicáveis desses
        provedores.
      </p>

      <h2>4. Planos, limites e cobrança</h2>
      <p>
        Planos, períodos de teste, limites de uso e valores aplicáveis são os
        apresentados no momento da contratação. Eventuais mudanças serão
        informadas pelos canais apropriados antes de produzirem efeitos para a
        loja, quando exigido.
      </p>

      <h2>5. Uso aceitável</h2>
      <p>
        Não é permitido usar o aplicativo para fraude, abuso, envio de conteúdo
        ilícito, violação de direitos, acesso não autorizado ou comunicações em
        desacordo com a legislação e as políticas dos canais utilizados.
        Poderemos restringir o uso quando necessário para proteger usuários, a
        plataforma ou terceiros, ou para cumprir obrigação legal.
      </p>

      <h2>6. Disponibilidade e alterações</h2>
      <p>
        Trabalhamos para manter o serviço disponível e seguro, mas podem
        ocorrer interrupções, manutenção ou limitações de serviços de terceiros.
        Funcionalidades podem ser ajustadas para segurança, compatibilidade,
        cumprimento legal ou evolução do produto.
      </p>

      <h2>7. Privacidade e dados</h2>
      <p>
        O tratamento de dados pessoais é descrito na{" "}
        <a href="/privacidade">Política de Privacidade</a>. A loja deve consultar
        esse documento antes de configurar automações que utilizem dados de
        clientes.
      </p>

      <h2>8. Cancelamento e encerramento</h2>
      <p>
        A loja pode interromper o uso e desinstalar o aplicativo pelo painel da
        Nuvemshop. Solicitações relacionadas a dados e suporte seguirão a
        Política de Privacidade e os canais informados na página de suporte.
      </p>

      <h2>9. Suporte e contato</h2>
      <p>
        Para dúvidas, incidentes ou solicitações, consulte a{" "}
        <a href="/suporte">página de suporte do Nuvem Rush</a>.
      </p>
    </main>
  );
}

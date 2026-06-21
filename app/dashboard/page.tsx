// Tela inicial do app incorporado (roda dentro do iframe do admin).
// Usa Nimbus para UI e Nexo para integrar com o admin da Nuvemshop.
"use client";
import { useEffect, useState } from "react";
import { Box, Title, Text, Card, Button } from "@nimbus-ds/components";
import { initNexo } from "@/lib/nexo";

export default function DashboardPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initNexo()
      .then(() => setReady(true))
      .catch((e) => console.error("Nexo falhou:", e));
  }, []);

  return (
    <Box padding="6" display="flex" flexDirection="column" gap="4">
      <Title as="h1">Nuvem Rush</Title>
      <Text>
        {ready ? "Conectado ao admin da Nuvemshop." : "Conectando ao admin..."}
      </Text>

      <Card>
        <Card.Header title="Seus fluxos de automacao" />
        <Card.Body>
          <Text>
            Crie regras do tipo SE (produto / SKU / categoria / valor) ENTAO
            (e-mail / WhatsApp apos X dias).
          </Text>
        </Card.Body>
        <Card.Footer>
          <Button as="a" href="/dashboard/flows/new" appearance="primary">
            Criar novo fluxo
          </Button>
        </Card.Footer>
      </Card>
    </Box>
  );
}

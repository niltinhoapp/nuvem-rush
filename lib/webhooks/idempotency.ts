// Idempotencia de webhooks (parte PURA, sem dependencia de Firestore para
// poder ser testada isoladamente). A impl com Firestore fica em
// idempotency.firestore.ts.
//
// Chave deterministica por loja: mesmo (evento, recurso) sempre gera a mesma
// chave. Assim, a MESMA entrega recebida N vezes produz efeito uma unica vez,
// enquanto eventos legitimos diferentes (ex.: order/paid vs order/fulfilled do
// mesmo pedido) geram chaves diferentes e NAO sao descartados.

export function eventKey(event: string, resourceId: string | number): string {
  // "/" nao e permitido em doc id do Firestore -> normaliza para "_".
  return `${event}:${resourceId}`.replace(/\//g, "_");
}

export interface EventClaim {
  // Reivindica o processamento de um evento de forma ATOMICA (create-if-not-
  // exists). Retorna true na 1a vez, false se ja havia sido reivindicado
  // (duplicata). A atomicidade e o que resolve duplicatas concorrentes.
  claim(storeId: string, key: string): Promise<boolean>;
  // Libera a reivindicacao (usado quando o processamento falha, para permitir
  // que uma reentrega legitima da Nuvemshop reprocesse o evento).
  release(storeId: string, key: string): Promise<void>;
}

// Implementacao em memoria com semantica atomica de create-if-not-exists.
// Serve para testes e como referencia do contrato esperado da impl Firestore.
export function createInMemoryEventClaim(): EventClaim {
  const seen = new Set<string>();
  const k = (storeId: string, key: string) => `${storeId}/${key}`;
  return {
    async claim(storeId, key) {
      const kk = k(storeId, key);
      // check-and-set sincrono (sem await no meio) = secao critica atomica.
      if (seen.has(kk)) return false;
      seen.add(kk);
      return true;
    },
    async release(storeId, key) {
      seen.delete(k(storeId, key));
    },
  };
}

// SHIM LOCAL de tipos do NubeSDK — reflete a API oficial (State/Events) sem
// instalar dependências. No EMPACOTAMENTO, substituir estes tipos por
// `@tiendanube/nube-sdk-types` (fonte oficial). Campos baseados na doc:
// state.store = { id, name, domain, currency, language }; state.cart = { id,
// items, prices, validation }; state.customer = contact/addresses.

export interface NubeSDKStore {
  id: string;
  name?: unknown;
  domain?: string;
  currency?: string;
  language?: string;
}

export interface NubeSDKCartItem {
  product_id?: number;
  variant_id?: number;
  sku?: string | null;
  quantity?: number;
}

export interface NubeSDKCart {
  id: string;
  items: NubeSDKCartItem[];
  prices?: { total?: number };
}

// Customer: apenas presença importa para o módulo (não lemos PII aqui).
export type NubeSDKCustomer = Record<string, unknown>;

export interface NubeSDKState {
  store: NubeSDKStore;
  cart?: NubeSDKCart;
  customer?: NubeSDKCustomer;
}

// Instância injetada no entry point: `export function App(nube: NubeSDK)`.
export interface NubeSDK {
  on(event: string, handler: (state: NubeSDKState) => void): void;
  getState(): NubeSDKState;
}

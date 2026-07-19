// Tipos crus (parciais) dos recursos da API Nuvemshop que consumimos.
// Campos localizados (ex.: name) vem como objeto { pt: "..." } ou string.
export type LocalizedString = string | { [lang: string]: string };

export interface NsCustomer {
  id?: number | string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface NsOrderProduct {
  product_id?: number | string;
  variant_id?: number | string;
  sku?: string | null;
  name?: LocalizedString;
  price?: string | number;
  quantity?: string | number;
}

export interface NsFulfillment {
  tracking_info?: { code?: string | null; url?: string | null } | null;
}

export interface NsOrder {
  id: number | string;
  number?: number | string;
  customer?: NsCustomer;
  contact_email?: string;
  contact_name?: string;
  contact_phone?: string;
  products?: NsOrderProduct[];
  total?: string | number;
  // Rastreio / logistica
  shipping_status?: string | null;
  shipping_tracking_number?: string | null;
  shipping_tracking_url?: string | null;
  fulfillments?: NsFulfillment[];
}

export interface NsCategoryRef {
  id: number | string;
  name?: LocalizedString;
}

export interface NsProduct {
  id: number | string;
  name?: LocalizedString;
  brand?: string | null;
  categories?: NsCategoryRef[];
}

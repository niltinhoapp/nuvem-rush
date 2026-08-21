import { FieldPath } from "firebase-admin/firestore";
import { col } from "@/lib/firebase/admin";
import type { Contact } from "@/types";
import {
  customerKeys,
  normalizeEmail,
  normalizePhone,
  type LgpdWebhook,
} from "./model";

async function allContacts(storeId: string) {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    let query = col(storeId, "contacts").orderBy(FieldPath.documentId()).limit(400);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    docs.push(...page.docs);
    if (page.size < 400) return docs;
    cursor = page.docs.at(-1);
  }
}

export async function findCustomerContact(
  storeId: string,
  payload: LgpdWebhook,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | undefined> {
  const customer = payload.customer;
  const hasIdentification = customer?.identification != null
    && String(customer.identification).trim().length > 0;
  if (!customer || (customerKeys(storeId, customer).length === 0 && !hasIdentification)) {
    throw new Error("lgpd_customer_identifier_missing");
  }

  const contacts = await allContacts(storeId);
  const email = normalizeEmail(customer.email);
  const phone = normalizePhone(customer.phone);
  const identification = customer.identification == null
    ? undefined
    : String(customer.identification).trim();
  const matches = contacts.filter((doc) => {
    const data = doc.data() as Partial<Contact> & { identification?: unknown };
    return Boolean(
      (customer.id && (String(data.nsCustomerId ?? "") === customer.id || doc.id === customer.id))
      || (email && normalizeEmail(data.email ?? undefined) === email)
      || (phone && normalizePhone(data.phone ?? undefined) === phone)
      || (identification && String(data.identification ?? "").trim() === identification),
    );
  });
  const unique = [...new Map(matches.map((doc) => [doc.id, doc])).values()];
  if (unique.length > 1) throw new Error("lgpd_customer_ambiguous");
  return unique[0];
}

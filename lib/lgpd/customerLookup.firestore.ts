import { FieldPath } from "firebase-admin/firestore";
import { col } from "@/lib/firebase/admin";
import type { Contact } from "@/types";
import {
  customerKeys,
  dataRequestCustomerKeys,
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

export async function findCustomerContactByKeyHashes(
  storeId: string,
  keyHashes: string[],
): Promise<FirebaseFirestore.QueryDocumentSnapshot | undefined> {
  if (keyHashes.length === 0) throw new Error("lgpd_data_request_not_deliverable");
  const expected = new Set(keyHashes);
  const contacts = await allContacts(storeId);
  const matches = contacts.filter((doc) => {
    const data = doc.data() as Partial<Contact> & { identification?: unknown };
    const shared = {
      email: data.email ?? undefined,
      phone: data.phone ?? undefined,
      identification: data.identification as string | number | undefined,
    };
    const candidateHashes = [data.nsCustomerId, doc.id].flatMap((id) =>
      dataRequestCustomerKeys(storeId, {
        ...shared,
        ...(id == null ? {} : { id: String(id) }),
      }),
    );
    return candidateHashes.some((hash) => expected.has(hash));
  });
  const unique = [...new Map(matches.map((doc) => [doc.id, doc])).values()];
  if (unique.length > 1) throw new Error("lgpd_customer_ambiguous");
  return unique[0];
}

// Acao "Adicionar tag": marca o contato com uma tag configurada no step.
// Util para segmentacao (ex.: "recompra_enviada", "cliente_vip").
import { col } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type { Step } from "@/types";

export async function applyTag(params: {
  storeId: string;
  enrollmentId: string;
  step: Step;
}): Promise<void> {
  const { storeId, enrollmentId, step } = params;
  const tagName = (step.config as { tagName?: string } | undefined)?.tagName?.trim();
  if (!tagName) throw new Error("step sem tagName configurado");

  const enroll = (await col(storeId, "enrollments").doc(enrollmentId).get()).data()!;
  await col(storeId, "contacts").doc(enroll.contactId).update({
    tags: FieldValue.arrayUnion(tagName),
  });
}

// Firebase Admin SDK — usado SOMENTE no servidor (API routes / Cloud Functions).
// Tokens de acesso, jobs e logs nunca devem ser lidos pelo client.
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let app: App;

if (!getApps().length) {
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
} else {
  app = getApps()[0]!;
}

export const db = getFirestore(app);

// Helpers de caminho multi-tenant. Tudo fica sob stores/{storeId}/...
export const storeRef = (storeId: string) => db.collection("stores").doc(storeId);
export const col = (storeId: string, name: string) =>
  storeRef(storeId).collection(name);

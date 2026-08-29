import { PLANS } from "@/lib/plans";

interface StoreInstallToken {
  accessToken: string;
  scope: string;
}

interface StoreInstallData {
  storeId: string;
  accessToken: string;
  scope: string;
  status: "active";
  plan?: "essencial";
  installedAt?: number;
  quotas?: {
    contactsLimit: number;
    dispatchesMonthLimit: number;
    dispatchesMonthUsed: number;
    whatsappMonthLimit: number;
    whatsappMonthUsed: number;
    periodKey: string;
  };
}

export interface ExistingStoreInstallState {
  exists: boolean;
  status?: unknown;
}

export function isFirstCommercialInstall(existing: ExistingStoreInstallState): boolean {
  return !existing.exists || existing.status === "redacted";
}

export function buildStoreInstallData(
  storeId: string,
  token: StoreInstallToken,
  existing: ExistingStoreInstallState,
  now: number = Date.now(),
): StoreInstallData {
  const renewableData: StoreInstallData = {
    storeId,
    accessToken: token.accessToken,
    scope: token.scope,
    status: "active",
  };

  if (!isFirstCommercialInstall(existing)) return renewableData;

  return {
    ...renewableData,
    plan: "essencial",
    installedAt: now,
    quotas: {
      contactsLimit: PLANS.essencial.contactsLimit,
      dispatchesMonthLimit: PLANS.essencial.emailsMonthLimit,
      dispatchesMonthUsed: 0,
      whatsappMonthLimit: PLANS.essencial.whatsappMonthLimit,
      whatsappMonthUsed: 0,
      periodKey: new Date(now).toISOString().slice(0, 7),
    },
  };
}

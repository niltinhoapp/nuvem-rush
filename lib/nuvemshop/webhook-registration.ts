import { REQUIRED_WEBHOOK_EVENTS } from "./webhooks";

export type WebhookRegistrationResult = {
  event: (typeof REQUIRED_WEBHOOK_EVENTS)[number];
  status: "success" | "transient_error" | "permanent_error";
  action?: "created" | "reused";
  httpStatus?: number;
};

type WebhookRegistrar = {
  listWebhooks(event: string, url: string): Promise<Array<{ event: string; url: string }>>;
  createWebhook(event: string, url: string): Promise<unknown>;
};

function errorStatus(reason: unknown): number | undefined {
  if (typeof reason === "object" && reason !== null && "status" in reason) {
    const status = Number((reason as { status?: unknown }).status);
    if (Number.isInteger(status)) return status;
  }
  if (reason instanceof Error) {
    const match = reason.message.match(/(?:API|HTTP)\s+(\d{3})/i);
    if (match) return Number(match[1]);
  }
  return undefined;
}

export function classifyWebhookRegistrationError(
  event: WebhookRegistrationResult["event"],
  reason: unknown,
): WebhookRegistrationResult {
  const httpStatus = errorStatus(reason);
  const transient =
    httpStatus === 429 ||
    (httpStatus !== undefined && httpStatus >= 500) ||
    (reason instanceof Error && reason.name === "AbortError");
  return {
    event,
    status: transient ? "transient_error" : "permanent_error",
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

export async function registerRequiredWebhooks(
  client: WebhookRegistrar,
  url: string,
): Promise<WebhookRegistrationResult[]> {
  const settled = await Promise.allSettled(
    REQUIRED_WEBHOOK_EVENTS.map(async (event) => {
      // GET /webhooks is the authority. If listing fails, this promise rejects
      // and no POST is attempted under uncertainty.
      const existing = await client.listWebhooks(event, url);
      if (existing.some((webhook) => webhook.event === event && webhook.url === url)) {
        return "reused" as const;
      }
      await client.createWebhook(event, url);
      return "created" as const;
    }),
  );
  return settled.map((result, index) => {
    const event = REQUIRED_WEBHOOK_EVENTS[index]!;
    return result.status === "fulfilled"
      ? { event, status: "success", action: result.value }
      : classifyWebhookRegistrationError(event, result.reason);
  });
}

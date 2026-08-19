import { REQUIRED_WEBHOOK_EVENTS } from "./webhooks";

export type WebhookRegistrationResult = {
  event: (typeof REQUIRED_WEBHOOK_EVENTS)[number];
  status: "success" | "transient_error" | "permanent_error";
  httpStatus?: number;
};

type WebhookRegistrar = {
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
    REQUIRED_WEBHOOK_EVENTS.map((event) => client.createWebhook(event, url)),
  );
  return settled.map((result, index) => {
    const event = REQUIRED_WEBHOOK_EVENTS[index]!;
    return result.status === "fulfilled"
      ? { event, status: "success" }
      : classifyWebhookRegistrationError(event, result.reason);
  });
}

export function isWebhookInboxCronAuthorized(
  secret: string | undefined,
  authorization: string | null,
): boolean {
  return Boolean(secret?.trim()) && authorization === `Bearer ${secret}`;
}

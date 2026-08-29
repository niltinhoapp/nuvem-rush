import type { DataRequestDashboardCursor } from "./dataRequest";

const REQUEST_ID_PATTERN = /^[a-f0-9]{64}$/;

export class InvalidDataRequestCursorError extends Error {
  constructor() {
    super("invalid_data_request_cursor");
    this.name = "InvalidDataRequestCursorError";
  }
}

export function encodeDataRequestCursor(cursor: DataRequestDashboardCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeDataRequestCursor(value: string): DataRequestDashboardCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new InvalidDataRequestCursorError();
    const cursor = parsed as Record<string, unknown>;
    if (
      Object.keys(cursor).sort().join(",") !== "receivedAt,requestId"
      || typeof cursor.receivedAt !== "number"
      || !Number.isFinite(cursor.receivedAt)
      || typeof cursor.requestId !== "string"
      || !REQUEST_ID_PATTERN.test(cursor.requestId)
    ) {
      throw new InvalidDataRequestCursorError();
    }
    return { receivedAt: cursor.receivedAt, requestId: cursor.requestId };
  } catch (error) {
    if (error instanceof InvalidDataRequestCursorError) throw error;
    throw new InvalidDataRequestCursorError();
  }
}

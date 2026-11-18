import { createHmac, timingSafeEqual } from "node:crypto";
import { isAllowedPage } from "./pages";
import type { NormalizedMessage } from "./types";

export function validSignature(
  raw: Buffer,
  signature: string | null,
  secret: string,
) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature))
    return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

export function verificationChallenge(url: URL, token: string | undefined) {
  if (!token || url.searchParams.get("hub.mode") !== "subscribe") return null;
  const challenge = url.searchParams.get("hub.challenge");
  const received = url.searchParams.get("hub.verify_token");
  if (!challenge || received === null) return null;
  const expectedBytes = Buffer.from(token);
  const receivedBytes = Buffer.from(received);
  const matches =
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes);
  return matches ? challenge : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Discard unsupported events independently. Never store the raw payload or profile data.
export function normalizeWebhook(
  payload: unknown,
  now = Date.now(),
): NormalizedMessage[] {
  const body = record(payload);
  if (body?.object !== "page" || !Array.isArray(body.entry)) return [];
  const messages: NormalizedMessage[] = [];
  for (const value of body.entry) {
    const entry = record(value);
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !isAllowedPage(entry.id) ||
      !Array.isArray(entry.messaging)
    )
      continue;
    for (const value of entry.messaging) {
      const event = record(value),
        message = record(event?.message);
      const sender = record(event?.sender)?.id,
        recipient = record(event?.recipient)?.id;
      if (
        !event ||
        !message ||
        typeof message.mid !== "string" ||
        !message.mid ||
        message.mid.length > 512
      )
        continue;
      const echo = message.is_echo === true;
      const psid = echo ? recipient : sender;
      if (
        (echo ? sender : recipient) !== entry.id ||
        typeof psid !== "string" ||
        !/^\d{1,64}$/.test(psid) ||
        isAllowedPage(psid)
      )
        continue;
      if (
        typeof event.timestamp !== "number" ||
        !Number.isFinite(event.timestamp) ||
        event.timestamp < 0 ||
        event.timestamp > now + 300_000
      )
        continue;
      const sentAt = new Date(event.timestamp);
      if (!Number.isFinite(sentAt.getTime())) continue;
      const attachmentTypes = Array.isArray(message.attachments)
        ? message.attachments
            .map((item) => record(item)?.type)
            .filter((type): type is string => typeof type === "string")
            .map((type) => type.slice(0, 40))
            .slice(0, 20)
        : [];
      const metadata =
        typeof message.metadata === "string" ? message.metadata : "";
      messages.push({
        page_id: entry.id,
        customer_psid: psid,
        meta_message_id: message.mid,
        direction: echo ? "outbound" : "inbound",
        text:
          typeof message.text === "string" ? message.text.slice(0, 20000) : "",
        attachment_types: attachmentTypes,
        sent_at: sentAt.toISOString(),
        client_request_id:
          echo &&
          /^fnb:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            metadata,
          )
            ? metadata.slice(4)
            : null,
      });
    }
  }
  return messages;
}

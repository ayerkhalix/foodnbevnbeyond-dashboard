import { adminSupabase } from "@/lib/supabase/admin";
import { logFailure } from "@/lib/messenger/http";
import {
  normalizeWebhook,
  validSignature,
  verificationChallenge,
} from "@/lib/messenger/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const token = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!token) return new Response("Not configured", { status: 503 });
  const challenge = verificationChallenge(new URL(request.url), token);
  return challenge === null
    ? new Response("Forbidden", { status: 403 })
    : new Response(challenge, {
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
}

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });
  if (Number(request.headers.get("content-length")) > 1_048_576)
    return new Response("Payload too large", { status: 413 });
  // Read a bounded raw stream; signatures must be checked before JSON decoding.
  const reader = request.body?.getReader();
  if (!reader) return new Response("Invalid payload", { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_048_576) {
      await reader.cancel();
      return new Response("Payload too large", { status: 413 });
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks);
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), secret))
    return new Response("Forbidden", { status: 403 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const messages = normalizeWebhook(payload);
  if (messages.length) {
    try {
      const { error } = await adminSupabase()
        .rpc("messenger_ingest", { events: messages })
        .abortSignal(AbortSignal.timeout(10_000));
      if (error) {
        logFailure("ingestion", error.code);
        return new Response("Retry later", { status: 503 });
      }
    } catch {
      logFailure("ingestion");
      return new Response("Retry later", { status: 503 });
    }
  }
  return new Response("EVENT_RECEIVED", {
    headers: { "Cache-Control": "no-store" },
  });
}

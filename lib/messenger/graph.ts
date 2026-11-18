import { createHmac } from "node:crypto";
export { replyWindowOpen, sendErrorText } from "./graph-client";

export const GRAPH_VERSION = "v26.0";
export type SendResult =
  | { state: "sent"; messageId: string }
  | { state: "failed" | "unknown"; code: string; retryAfter?: number };

export async function sendText(
  input: {
    pageId: string;
    psid: string;
    text: string;
    requestId: string;
    token: string;
    appSecret: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const response = await fetcher(
      `https://graph.facebook.com/${GRAPH_VERSION}/${input.pageId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: input.psid },
          messaging_type: "RESPONSE",
          message: { text: input.text, metadata: `fnb:${input.requestId}` },
          appsecret_proof: createHmac("sha256", input.appSecret)
            .update(input.token)
            .digest("hex"),
        }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      },
    );
    // A 5xx or unreadable success may follow acceptance. Never retry automatically.
    if (response.status >= 500) return { state: "unknown", code: "uncertain" };
    let data;
    try {
      data = await response.json();
    } catch {
      return { state: "unknown", code: "uncertain" };
    }
    if (response.ok && typeof data?.message_id === "string")
      return { state: "sent", messageId: data.message_id };
    if (response.ok) return { state: "unknown", code: "uncertain" };
    const code = data?.error?.code,
      subcode = data?.error?.error_subcode;
    if (response.status === 429 || [4, 17, 32, 613].includes(code)) {
      const header = Number(response.headers.get("retry-after"));
      return {
        state: "failed",
        code: "rate_limit",
        retryAfter:
          Number.isFinite(header) && header > 0 ? Math.min(header, 86400) : 60,
      };
    }
    if (code === 190) return { state: "failed", code: "token" };
    if ([2018278, 2018300].includes(subcode))
      return { state: "failed", code: "window_closed" };
    if ([10, 200].includes(code))
      return { state: "failed", code: "permission" };
    if (code === 551) return { state: "failed", code: "unavailable" };
    return { state: "failed", code: "rejected" };
  } catch {
    return { state: "unknown", code: "uncertain" };
  }
}

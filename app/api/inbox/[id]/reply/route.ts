import { adminSupabase } from "@/lib/supabase/admin";
import {
  json,
  logFailure,
  operator,
  sameOrigin,
  UUID,
} from "@/lib/messenger/http";
import { sendErrorText, sendText } from "@/lib/messenger/graph";
import { isAllowedPage } from "@/lib/messenger/pages";
import type { Message } from "@/lib/messenger/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request)) return json({ error: "Invalid origin." }, 403);
  const auth = await operator();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "Conversation not found." }, 404);
  if (Number(request.headers.get("content-length")) > 16000)
    return json({ error: "Reply is too long." }, 413);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid reply." }, 400);
  }
  if (
    typeof body?.text !== "string" ||
    !body.text.trim() ||
    body.text.length > 2000 ||
    typeof body?.requestId !== "string" ||
    !UUID.test(body.requestId)
  )
    return json({ error: "Enter a reply of up to 2,000 characters." }, 400);
  const text = body.text.trim();
  const conversation = await auth.db
    .from("messenger_conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (conversation.error)
    return json(
      { error: "The conversation could not be checked. Your draft is kept in this tab." },
      503,
    );
  if (!conversation.data || !isAllowedPage(conversation.data.page_id))
    return json({ error: "Conversation not found or access removed." }, 404);
  const pageId = conversation.data.page_id;
  const token = process.env[`META_PAGE_TOKEN_${pageId}`],
    appSecret = process.env.META_APP_SECRET;
  if (!token || !appSecret)
    return json(
      {
        error: sendErrorText("not_configured"),
        code: "not_configured",
        outcome: "not_sent",
      },
      503,
    );
  try {
    const admin = adminSupabase();
    const prepared = await admin.rpc("messenger_prepare_reply", {
      operator_id: auth.user.id,
      conversation: id,
      request_id: body.requestId,
      reply_text: text,
    });
    if (prepared.error) {
      logFailure("reply_prepare", prepared.error.code);
      return json(
        {
          error: "Reply could not be prepared. Your draft is kept in this tab.",
          outcome: "not_sent",
        },
        503,
      );
    }
    const result = prepared.data as {
      error?: string;
      existing?: boolean;
      message: Message;
    };
    if (result.error)
      return json(
        {
          error:
            result.error === "forbidden"
              ? "Access to this restaurant was removed."
              : sendErrorText(result.error),
          code: result.error,
          outcome: "not_sent",
        },
        result.error === "forbidden" ? 403 : 409,
      );
    if (result.existing)
      return json({
        message: result.message,
        outcome: result.message.delivery_state,
      });
    const outcome = await sendText({
      pageId,
      psid: conversation.data.customer_psid,
      text,
      requestId: body.requestId,
      token,
      appSecret,
    });
    const finished = await admin.rpc("messenger_finish_reply", {
      message: result.message.id,
      result_state: outcome.state,
      provider_id: outcome.state === "sent" ? outcome.messageId : null,
      failure_code: outcome.state === "sent" ? null : outcome.code,
      cooldown_seconds:
        outcome.state !== "sent" ? (outcome.retryAfter ?? null) : null,
    });
    if (finished.error) {
      logFailure("reply_finish", finished.error.code);
      return json(
        {
          error: sendErrorText("uncertain"),
          code: "uncertain",
          outcome: "unknown",
        },
        503,
      );
    }
    const message = finished.data as Message;
    return json(
      {
        message,
        outcome: message.delivery_state,
        ...(message.delivery_state !== "sent"
          ? {
              error: sendErrorText(message.error_code),
              code: message.error_code,
            }
          : {}),
      },
      message.delivery_state === "sent" ? 200 : 502,
    );
  } catch {
    logFailure("reply");
    return json(
      {
        error: sendErrorText("uncertain"),
        code: "uncertain",
        outcome: "unknown",
      },
      503,
    );
  }
}

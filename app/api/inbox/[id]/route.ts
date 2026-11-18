import {
  json,
  logFailure,
  operator,
  sameOrigin,
  UUID,
} from "@/lib/messenger/http";
import { refreshConversationProfiles } from "@/lib/messenger/profiles";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await operator();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "Conversation not found." }, 404);
  const before = new URL(request.url).searchParams.get("before");
  const offset = Number(before || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    return json({ error: "Invalid page." }, 400);
  const conversation = await auth.db
    .from("messenger_conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (conversation.error)
    return json({ error: "The conversation could not load." }, 503);
  if (!conversation.data)
    return json({ error: "Conversation not found or access removed." }, 404);
  const messages = await auth.db
    .from("messenger_messages")
    .select("*")
    .eq("conversation_id", id)
    .order("sent_at", { ascending: false })
    .order("id")
    .range(offset, offset + 49);
  if (messages.error) {
    logFailure("message_read", messages.error.code);
    return json({ error: "Messages could not load. Try again." }, 503);
  }
  return json({
    conversation: (await refreshConversationProfiles([conversation.data]))[0],
    messages: messages.data.reverse(),
    next: messages.data.length === 50 ? offset + 50 : null,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request)) return json({ error: "Invalid origin." }, 403);
  const auth = await operator();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "Conversation not found." }, 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid read status." }, 400);
  }
  if (
    typeof body?.lastReadAt !== "string" ||
    !Number.isFinite(Date.parse(body.lastReadAt))
  )
    return json({ error: "Invalid read status." }, 400);
  const result = await auth.db.rpc("messenger_mark_read", {
    conversation: id,
    viewed_at: body.lastReadAt,
  });
  if (result.error)
    return json({ error: "Read status could not be saved." }, 503);
  if (!result.data) return json({ error: "Conversation not found." }, 404);
  return json({ ok: true });
}

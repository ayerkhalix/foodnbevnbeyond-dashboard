import { json, logFailure, operator } from "@/lib/messenger/http";
import { isAllowedPage } from "@/lib/messenger/pages";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await operator();
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const page = url.searchParams.get("page"),
    before = url.searchParams.get("before");
  if (page && !isAllowedPage(page))
    return json({ error: "Unknown restaurant." }, 400);
  const offset = Number(before || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    return json({ error: "Invalid page." }, 400);
  let query = auth.db
    .from("messenger_conversations")
    .select("*")
    .order("last_message_at", { ascending: false })
    .order("id")
    .range(offset, offset + 49);
  if (page) query = query.eq("page_id", page);
  const [conversations, pages] = await Promise.all([
    query,
    auth.db
      .from("messenger_pages")
      .select("id,name,last_send_error,blocked_until"),
  ]);
  if (conversations.error || pages.error) {
    logFailure("inbox_read", conversations.error?.code || pages.error?.code);
    return json({ error: "The inbox could not load. Try refreshing." }, 503);
  }
  const ids = conversations.data.map((conversation) => conversation.id);
  const reads = ids.length
    ? await auth.db
        .from("messenger_reads")
        .select("conversation_id,last_read_at")
        .in("conversation_id", ids)
        .eq("user_id", auth.user.id)
    : { data: [], error: null };
  if (reads.error)
    return json({ error: "Read status could not load. Try refreshing." }, 503);
  return json({
    conversations: conversations.data,
    pages: pages.data,
    reads: reads.data,
    next: conversations.data.length === 50 ? offset + 50 : null,
  });
}

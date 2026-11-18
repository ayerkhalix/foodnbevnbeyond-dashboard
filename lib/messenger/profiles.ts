import "server-only";
import { adminSupabase } from "@/lib/supabase/admin";
import { logFailure } from "./http";
import { isAllowedPage } from "./pages";
import { fetchMessengerName, profileRefreshDue } from "./profile";
import type { Conversation } from "./types";

// Enrich only conversations already authorized by the caller's RLS query.
// Bound each inbox load to four lookups; the remaining names fill on later polls.
export async function refreshConversationProfiles(
  conversations: Conversation[],
): Promise<Conversation[]> {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return conversations;
  const due = conversations
    .filter(
      (conversation) =>
        isAllowedPage(conversation.page_id) &&
        /^\d{1,40}$/.test(conversation.customer_psid) &&
        process.env[`META_PAGE_TOKEN_${conversation.page_id}`] &&
        profileRefreshDue(conversation),
    )
    .slice(0, 4);
  if (!due.length) return conversations;
  const refreshed = new Map<string, Conversation>();
  try {
    const admin = adminSupabase();
    await Promise.all(
      due.map(async (conversation) => {
        const checkedAt = new Date().toISOString();
        let claim = admin
          .from("messenger_conversations")
          .update({ profile_checked_at: checkedAt })
          .eq("id", conversation.id)
          .eq("page_id", conversation.page_id);
        claim = conversation.profile_checked_at
          ? claim.eq("profile_checked_at", conversation.profile_checked_at)
          : claim.is("profile_checked_at", null);
        // The timestamp acts as an optimistic lease across operators and polls.
        const claimed = await claim
          .select("id")
          .abortSignal(AbortSignal.timeout(2000))
          .maybeSingle();
        if (claimed.error || !claimed.data) return;
        refreshed.set(conversation.id, {
          ...conversation,
          profile_checked_at: checkedAt,
        });
        const profile = await fetchMessengerName({
          psid: conversation.customer_psid,
          token: process.env[`META_PAGE_TOKEN_${conversation.page_id}`]!,
          appSecret,
        });
        if (!profile.name) {
          logFailure("profile_lookup", profile.error);
          return;
        }
        const saved = await admin
          .from("messenger_conversations")
          .update({ customer_name: profile.name })
          .eq("id", conversation.id)
          .eq("page_id", conversation.page_id)
          .eq("profile_checked_at", checkedAt)
          .select("customer_name")
          .abortSignal(AbortSignal.timeout(2000))
          .maybeSingle();
        if (saved.error) {
          logFailure("profile_cache", saved.error.code);
          return;
        }
        if (!saved.data) return;
        refreshed.set(conversation.id, {
          ...conversation,
          customer_name: profile.name,
          profile_checked_at: checkedAt,
        });
      }),
    );
  } catch {
    // A profile outage must never prevent reading or replying to a message.
    logFailure("profile_cache");
  }
  return conversations.map(
    (conversation) => refreshed.get(conversation.id) || conversation,
  );
}

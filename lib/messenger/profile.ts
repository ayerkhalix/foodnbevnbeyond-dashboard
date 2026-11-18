import { createHmac } from "node:crypto";
import { GRAPH_VERSION } from "./graph";

export type ProfileResult =
  | { name: string; error?: never }
  | { name: null; error: "token" | "permission" | "unavailable" };

export function profileRefreshDue(
  conversation: {
    customer_name?: string | null;
    profile_checked_at?: string | null;
  },
  now = Date.now(),
) {
  const checked = Date.parse(conversation.profile_checked_at || "");
  const lifetime = conversation.customer_name ? 7 * 86_400_000 : 3_600_000;
  return !Number.isFinite(checked) || now - checked >= lifetime;
}

export function profileName(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const profile = data as { first_name?: unknown; last_name?: unknown };
  const name = [profile.first_name, profile.last_name]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return name ? Array.from(name).slice(0, 200).join("") : null;
}

export async function fetchMessengerName(
  input: { psid: string; token: string; appSecret: string },
  fetcher: typeof fetch = fetch,
): Promise<ProfileResult> {
  if (!/^\d{1,40}$/.test(input.psid) || !input.token || !input.appSecret)
    return { name: null, error: "unavailable" };
  try {
    const url = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/${input.psid}`,
    );
    url.searchParams.set("fields", "first_name,last_name");
    url.searchParams.set(
      "appsecret_proof",
      createHmac("sha256", input.appSecret).update(input.token).digest("hex"),
    );
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${input.token}` },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || data?.error) {
      const code = data?.error?.code;
      return {
        name: null,
        error:
          code === 190
            ? "token"
            : [10, 200].includes(code)
              ? "permission"
              : "unavailable",
      };
    }
    const name = profileName(data);
    return name ? { name } : { name: null, error: "unavailable" };
  } catch {
    return { name: null, error: "unavailable" };
  }
}

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  conversationInitials,
  conversationName,
} from "../lib/messenger/identity";
import {
  fetchMessengerName,
  profileName,
  profileRefreshDue,
} from "../lib/messenger/profile";

test("names use only Meta's textual first and last name, preserving Unicode", () => {
  assert.equal(
    profileName({ first_name: "  José \n", last_name: " Dela  Cruz " }),
    "José Dela Cruz",
  );
  assert.equal(
    profileName({ first_name: "山田", last_name: "花子" }),
    "山田 花子",
  );
  assert.equal(profileName({ first_name: "Ayer" }), "Ayer");
  assert.equal(profileName({ first_name: 123, last_name: {} }), null);
  assert.equal(profileName({ name: "Unrequested field" }), null);
  assert.equal(profileName({ first_name: "  \u0000 " }), null);
  assert.equal(profileName(null), null);
  const longName = profileName({ first_name: "🌴".repeat(210) })!;
  assert.equal(Array.from(longName).length, 200);
  assert.equal(longName.endsWith("🌴"), true);
});

test("profile request uses the matching credential, app-secret proof, and minimal fields", async () => {
  let calls = 0;
  const result = await fetchMessengerName(
    { psid: "123456", token: "page-token", appSecret: "app-secret" },
    async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, "https://graph.facebook.com");
      assert.equal(url.pathname, "/v26.0/123456");
      assert.equal(url.searchParams.get("fields"), "first_name,last_name");
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(
        url.searchParams.get("appsecret_proof"),
        createHmac("sha256", "app-secret").update("page-token").digest("hex"),
      );
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer page-token",
      );
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.signal?.aborted, false);
      return Response.json({ first_name: "Ayer", last_name: "Khalid" });
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { name: "Ayer Khalid" });
});

test("missing profile access, expired tokens, invalid bodies, and network errors are recoverable", async () => {
  const input = { psid: "123456", token: "token", appSecret: "secret" };
  for (const [code, error] of [
    [10, "permission"],
    [200, "permission"],
    [190, "token"],
    [4, "unavailable"],
  ] as const) {
    assert.deepEqual(
      await fetchMessengerName(input, async () =>
        Response.json({ error: { code } }, { status: 400 }),
      ),
      { name: null, error },
    );
  }
  assert.deepEqual(
    await fetchMessengerName(input, async () => new Response("not JSON")),
    { name: null, error: "unavailable" },
  );
  assert.deepEqual(
    await fetchMessengerName(input, async () => {
      throw new Error("network");
    }),
    { name: null, error: "unavailable" },
  );
  assert.deepEqual(
    await fetchMessengerName(input, async () => Response.json({})),
    { name: null, error: "unavailable" },
  );
});

test("invalid identities or missing credentials never call the provider", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw new Error("Provider must not be called");
  };
  for (const input of [
    { psid: "../me?fields=email", token: "token", appSecret: "secret" },
    { psid: "123", token: "", appSecret: "secret" },
    { psid: "123", token: "token", appSecret: "" },
  ])
    assert.deepEqual(await fetchMessengerName(input, fetcher), {
      name: null,
      error: "unavailable",
    });
  assert.equal(calls, 0);
});

test("successful names refresh weekly and unavailable names retry hourly", () => {
  const now = Date.now();
  const checked = (ago: number) => new Date(now - ago).toISOString();
  assert.equal(profileRefreshDue({}, now), true);
  assert.equal(profileRefreshDue({ profile_checked_at: "invalid" }, now), true);
  assert.equal(
    profileRefreshDue({ profile_checked_at: checked(3_599_999) }, now),
    false,
  );
  assert.equal(
    profileRefreshDue({ profile_checked_at: checked(3_600_000) }, now),
    true,
  );
  assert.equal(
    profileRefreshDue(
      { customer_name: "Ayer", profile_checked_at: checked(86_400_000) },
      now,
    ),
    false,
  );
  assert.equal(
    profileRefreshDue(
      { customer_name: "Ayer", profile_checked_at: checked(7 * 86_400_000) },
      now,
    ),
    true,
  );
});

test("display identities use real names and initials with a truthful nonnumeric fallback", () => {
  assert.equal(
    conversationName({ customer_name: "José Dela Cruz" }),
    "José Dela Cruz",
  );
  assert.equal(conversationInitials({ customer_name: "José Dela Cruz" }), "JC");
  assert.equal(conversationInitials({ customer_name: "山田 花子" }), "山花");
  assert.equal(conversationName({ customer_name: null }), "Messenger user");
  assert.equal(conversationInitials({}), "?");
});

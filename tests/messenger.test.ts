import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  normalizeWebhook,
  validSignature,
  verificationChallenge,
} from "../lib/messenger/webhook";
import {
  GRAPH_VERSION,
  replyWindowOpen,
  sendText,
} from "../lib/messenger/graph";
import { PAGES } from "../lib/messenger/pages";
import { sameOrigin } from "../lib/messenger/origin";

const page = PAGES[0].id;
const now = Date.now();

test("mutation origin checks use the public HTTP Host and reject other origins", () => {
  assert.equal(
    sameOrigin(
      new Request("http://localhost:3000/api/inbox", {
        headers: { host: "127.0.0.1:42031", origin: "http://127.0.0.1:42031" },
      }),
    ),
    true,
  );
  assert.equal(
    sameOrigin(
      new Request("https://internal.example/api/inbox", {
        headers: { host: "inbox.example:443", origin: "https://inbox.example" },
      }),
    ),
    true,
  );
  for (const origin of [
    "https://other.example",
    "https://inbox.example:8443",
    "null",
    "",
  ]) {
    assert.equal(
      sameOrigin(
        new Request("https://inbox.example/api/inbox", {
          headers: { host: "inbox.example", origin },
        }),
      ),
      false,
    );
  }
});
const event = {
  sender: { id: "123456" },
  recipient: { id: page },
  timestamp: now - 1000,
  message: { mid: "m.test", text: "Dinner for two?" },
};

test("challenge requires the configured token, subscribe mode and a challenge", () => {
  const url = new URL(
    "https://example.test/api/meta/webhook?hub.mode=subscribe&hub.verify_token=correct&hub.challenge=0123",
  );
  assert.equal(verificationChallenge(url, "correct"), "0123");
  assert.equal(verificationChallenge(url, "wrong"), null);
  assert.equal(verificationChallenge(url, "wrongxx"), null);
  assert.equal(verificationChallenge(url, undefined), null);
  url.searchParams.set("hub.mode", "unsubscribe");
  assert.equal(verificationChallenge(url, "correct"), null);
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.delete("hub.challenge");
  assert.equal(verificationChallenge(url, "correct"), null);
  url.searchParams.set("hub.challenge", "");
  assert.equal(verificationChallenge(url, "correct"), null);
});

test("HMAC verification uses exact raw bytes and rejects malformed signatures", () => {
  const raw = Buffer.from('{ "message": "hello 🌴" }');
  const signature = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
  assert.equal(validSignature(raw, signature, "secret"), true);
  assert.equal(validSignature(raw, signature.toUpperCase(), "secret"), true);
  assert.equal(validSignature(raw, signature, ""), false);
  assert.equal(
    validSignature(Buffer.from('{"message":"hello 🌴"}'), signature, "secret"),
    false,
  );
  for (const invalid of [
    null,
    "",
    "sha256=a",
    `sha256=${"z".repeat(64)}`,
    `sha1=${"0".repeat(64)}`,
  ])
    assert.equal(validSignature(raw, invalid, "secret"), false);
});

test("all known Pages and entries are processed while unsupported events are ignored", () => {
  const payload = {
    object: "page",
    entry: [
      { id: "999", messaging: [event] },
      {
        id: page,
        messaging: [
          null,
          { delivery: {} },
          event,
          { ...event, recipient: { id: "999" } },
          { ...event, timestamp: now + 900000 },
          {
            ...event,
            message: {
              mid: "m.attachment",
              attachments: [
                {
                  type: "image",
                  payload: { url: "https://private.test/image" },
                },
              ],
            },
          },
        ],
      },
      {
        id: PAGES[1].id,
        messaging: [{ ...event, recipient: { id: PAGES[1].id } }],
      },
    ],
  };
  const messages = normalizeWebhook(payload, now);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].customer_psid, "123456");
  assert.deepEqual(messages[1].attachment_types, ["image"]);
  assert.equal(JSON.stringify(messages).includes("private.test"), false);
  assert.equal(
    normalizeWebhook({ object: "instagram", entry: payload.entry }).length,
    0,
  );
});

test("echo direction and metadata map to the same conversation and request", () => {
  const requestId = "a434a8ba-cd39-437e-9d92-959d2d7abcde";
  const messages = normalizeWebhook(
    {
      object: "page",
      entry: [
        {
          id: page,
          messaging: [
            {
              ...event,
              sender: { id: page },
              recipient: { id: "123456" },
              message: {
                mid: "m.echo",
                is_echo: true,
                text: "Welcome",
                metadata: `fnb:${requestId}`,
              },
            },
          ],
        },
      ],
    },
    now,
  );
  assert.equal(messages[0].direction, "outbound");
  assert.equal(messages[0].customer_psid, "123456");
  assert.equal(messages[0].client_request_id, requestId);
});

test("24-hour window closes exactly at the boundary and ignores invalid/future times", () => {
  assert.equal(
    replyWindowOpen(new Date(now - 86_399_999).toISOString(), now),
    true,
  );
  for (const date of [
    null,
    "invalid",
    new Date(now - 86_400_000).toISOString(),
    new Date(now + 1).toISOString(),
  ])
    assert.equal(replyWindowOpen(date, now), false);
});

const sendInput = {
  pageId: page,
  psid: "123456",
  text: "Welcome",
  requestId: "a434a8ba-cd39-437e-9d92-959d2d7abcde",
  token: "test-only-token",
  appSecret: "test-only-secret",
};

test("Send API uses the stored Page, pinned version, RESPONSE and echo correlation", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(
      url,
      `https://graph.facebook.com/${GRAPH_VERSION}/${page}/messages`,
    );
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer test-only-token",
    );
    const body = JSON.parse(String(options?.body));
    assert.equal(body.messaging_type, "RESPONSE");
    assert.equal(body.recipient.id, "123456");
    assert.equal(body.message.metadata, `fnb:${sendInput.requestId}`);
    assert.equal(
      body.appsecret_proof,
      createHmac("sha256", sendInput.appSecret)
        .update(sendInput.token)
        .digest("hex"),
    );
    return Response.json({ message_id: "m.sent" });
  };
  assert.deepEqual(await sendText(sendInput, fetcher), {
    state: "sent",
    messageId: "m.sent",
  });
  assert.equal(calls, 1);
});

test("network, server and unreadable acceptance stay uncertain without automatic retries", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("timeout");
    },
    async () => new Response("", { status: 503 }),
    async () => new Response("bad JSON", { status: 200 }),
    async () => Response.json({}),
  ]) {
    let calls = 0;
    const result = await sendText(sendInput, async () => {
      calls++;
      return fetcher();
    });
    assert.deepEqual(result, { state: "unknown", code: "uncertain" });
    assert.equal(calls, 1);
  }
});

test("revoked access, closed windows and Page rate limits have explicit outcomes", async () => {
  const cases = [
    { code: 190, expected: "token" },
    { code: 200, expected: "permission" },
    { code: 10, error_subcode: 2018278, expected: "window_closed" },
    { code: 551, expected: "unavailable" },
  ];
  for (const entry of cases)
    assert.deepEqual(
      await sendText(sendInput, async () =>
        Response.json({ error: entry }, { status: 400 }),
      ),
      { state: "failed", code: entry.expected },
    );
  assert.deepEqual(
    await sendText(sendInput, async () =>
      Response.json(
        { error: { code: 613 } },
        { status: 429, headers: { "retry-after": "120" } },
      ),
    ),
    { state: "failed", code: "rate_limit", retryAfter: 120 },
  );
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const moringa = "500981746436108",
  coco = "109815532143585";
const user = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const requestId = "20000000-0000-4000-8000-000000000001";
let conversationId: string;

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    insert into auth.users(id) values ('${user}'),('${other}');
  `);
  const migrations = readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  }
  await db.query(
    "insert into messenger_page_members(page_id,user_id) values ($1,$2),($3,$4)",
    [moringa, user, coco, other],
  );
});
after(async () => {
  await db.close();
});

function event(
  mid: string,
  page = moringa,
  psid = "123456",
  millisecondsAgo = 1000,
) {
  return {
    page_id: page,
    customer_psid: psid,
    meta_message_id: mid,
    direction: "inbound",
    text: mid,
    attachment_types: [],
    sent_at: new Date(Date.now() - millisecondsAgo).toISOString(),
    client_request_id: null,
  };
}
async function ingest(events: unknown[]) {
  await db.exec("set role service_role");
  try {
    await db.query("select messenger_ingest($1::jsonb)", [
      JSON.stringify(events),
    ]);
  } finally {
    await db.exec("reset role");
  }
}
async function prepare(
  id = requestId,
  actor = user,
  conversation = conversationId,
) {
  await db.exec("set role service_role");
  try {
    return (
      await db.query<{
        result: {
          error?: string;
          existing?: boolean;
          message: { id: string; delivery_state: string };
        };
      }>("select messenger_prepare_reply($1,$2,$3,$4) as result", [
        actor,
        conversation,
        id,
        "Reply from operator",
      ])
    ).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

test("migration enables RLS on every table and only seeds the four allowed Pages", async () => {
  const result = await db.query<{ relrowsecurity: boolean }>(
    "select relrowsecurity from pg_class where relname like 'messenger_%' and relkind='r'",
  );
  assert.equal(result.rows.length, 5);
  assert.ok(result.rows.every((row) => row.relrowsecurity));
  assert.equal(
    (await db.query("select * from messenger_pages")).rows.length,
    4,
  );
  await assert.rejects(
    db.query("insert into messenger_pages(id,name) values ('999','Unknown')"),
  );
});

test("duplicate and out-of-order events preserve one message and the latest inbound watermark", async () => {
  const first = event("m.new");
  await ingest([
    first,
    event("m.coco", coco),
    first,
    event("m.old", moringa, "123456", 90000),
  ]);
  const conversations = (
    await db.query<{ id: string; last_preview: string; last_inbound_at: Date }>(
      "select * from messenger_conversations where page_id=$1",
      [moringa],
    )
  ).rows;
  assert.equal(conversations.length, 1);
  conversationId = conversations[0].id;
  assert.equal(conversations[0].last_preview, "m.new");
  assert.equal(
    new Date(conversations[0].last_inbound_at).getTime(),
    Date.parse(first.sent_at),
  );
  assert.equal(
    (
      await db.query("select * from messenger_messages where page_id=$1", [
        moringa,
      ])
    ).rows.length,
    2,
  );
});

test("ingestion rolls back the complete batch on a persistence failure", async () => {
  await assert.rejects(
    ingest([
      event("m.rollback"),
      { ...event("m.invalid"), direction: "invalid" },
    ]),
  );
  assert.equal(
    (
      await db.query(
        "select id from messenger_messages where meta_message_id='m.rollback'",
      )
    ).rows.length,
    0,
  );
});

test("RLS prevents cross-Page reads, writes, membership changes and privileged RPC calls", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try {
    const pages = await db.query<{ id: string }>(
      "select id from messenger_pages",
    );
    assert.deepEqual(
      pages.rows.map((page) => page.id),
      [moringa],
    );
    assert.equal(
      (
        await db.query("select id from messenger_messages where page_id=$1", [
          coco,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into messenger_page_members(page_id,user_id) values ($1,$2)",
        [coco, user],
      ),
    );
    await assert.rejects(
      db.query("update messenger_messages set text='changed'"),
    );
    await assert.rejects(db.query("select messenger_ingest('[]'::jsonb)"));
    await assert.rejects(
      db.query("select messenger_prepare_reply($1,$2,$3,$4)", [
        user,
        conversationId,
        requestId,
        "Reply",
      ]),
    );
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select * from messenger_messages"));
  } finally {
    await db.exec("reset role");
  }
});

test("read watermarks use viewed data and never move backwards across tabs", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try {
    const viewed = new Date(Date.now() - 30000).toISOString();
    await db.query("select messenger_mark_read($1,$2)", [
      conversationId,
      viewed,
    ]);
    await db.query("select messenger_mark_read($1,$2)", [
      conversationId,
      new Date(Date.now() - 60000).toISOString(),
    ]);
    const reads = await db.query<{ last_read_at: Date }>(
      "select last_read_at from messenger_reads where conversation_id=$1",
      [conversationId],
    );
    assert.equal(
      new Date(reads.rows[0].last_read_at).getTime(),
      Date.parse(viewed),
    );
    assert.equal(
      (
        await db.query<{ result: boolean }>(
          "select messenger_mark_read($1,$2) as result",
          ["90000000-0000-4000-8000-000000000000", viewed],
        )
      ).rows[0].result,
      false,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("reply preparation rechecks Page membership and is idempotent", async () => {
  assert.equal((await prepare(requestId, other)).error, "forbidden");
  const first = await prepare();
  assert.equal(first.existing, false);
  const repeated = await prepare();
  assert.equal(repeated.existing, true);
  assert.equal(first.message.id, repeated.message.id);
  assert.equal(
    (await prepare("20000000-0000-4000-8000-000000000002")).error,
    "uncertain",
  );
});

test("echo before send completion reconciles the same outbound record and proves delivery", async () => {
  await ingest([
    {
      ...event("m.echo"),
      direction: "outbound",
      text: "Reply from operator",
      client_request_id: requestId,
    },
  ]);
  const prepared = await prepare();
  assert.equal(prepared.message.delivery_state, "sent");
  const result = await db.query<{ result: { delivery_state: string } }>(
    "select messenger_finish_reply($1,$2,$3,$4,$5) as result",
    [prepared.message.id, "unknown", null, "uncertain", null],
  );
  assert.equal(result.rows[0].result.delivery_state, "sent");
  assert.equal(
    (
      await db.query(
        "select id from messenger_messages where page_id=$1 and direction='outbound'",
        [moringa],
      )
    ).rows.length,
    1,
  );
});

test("echo without metadata before send response is merged by provider ID", async () => {
  const prepared = await prepare("20000000-0000-4000-8000-000000000003");
  await ingest([
    {
      ...event("m.no-metadata"),
      direction: "outbound",
      text: "Reply from operator",
    },
  ]);
  await db.query("select messenger_finish_reply($1,$2,$3,$4,$5)", [
    prepared.message.id,
    "sent",
    "m.no-metadata",
    null,
    null,
  ]);
  const result = await db.query(
    "select id from messenger_messages where page_id=$1 and meta_message_id=$2",
    [moringa, "m.no-metadata"],
  );
  assert.equal(result.rows.length, 1);
  assert.equal((result.rows[0] as { id: string }).id, prepared.message.id);
});

test("a closed reply window is enforced in the database", async () => {
  await ingest([event("m.expired", moringa, "654321", 86_400_001)]);
  const expired = (
    await db.query<{ id: string }>(
      "select id from messenger_conversations where customer_psid=$1",
      ["654321"],
    )
  ).rows[0].id;
  assert.equal(
    (await prepare("20000000-0000-4000-8000-000000000004", user, expired))
      .error,
    "window_closed",
  );
});

test("rate limiting pauses only the affected Page", async () => {
  const prepared = await prepare("20000000-0000-4000-8000-000000000005");
  await db.query("select messenger_finish_reply($1,$2,$3,$4,$5)", [
    prepared.message.id,
    "failed",
    null,
    "rate_limit",
    120,
  ]);
  assert.equal(
    (await prepare("20000000-0000-4000-8000-000000000006")).error,
    "rate_limit",
  );
  const pages = await db.query<{ id: string; blocked_until: Date | null }>(
    "select id,blocked_until from messenger_pages where id in ($1,$2)",
    [moringa, coco],
  );
  assert.ok(pages.rows.find((page) => page.id === moringa)?.blocked_until);
  assert.equal(
    pages.rows.find((page) => page.id === coco)?.blocked_until,
    null,
  );
});

test("an uncertain send cannot dispatch again and a later echo resolves it", async () => {
  const cocoConversation = (
    await db.query<{ id: string }>(
      "select id from messenger_conversations where page_id=$1",
      [coco],
    )
  ).rows[0].id;
  const uncertainRequest = "20000000-0000-4000-8000-000000000010";
  const prepared = await prepare(uncertainRequest, other, cocoConversation);
  await db.query("select messenger_finish_reply($1,$2,$3,$4,$5)", [
    prepared.message.id,
    "unknown",
    null,
    "uncertain",
    null,
  ]);
  const repeated = await prepare(uncertainRequest, other, cocoConversation);
  assert.equal(repeated.existing, true);
  assert.equal(repeated.message.delivery_state, "unknown");
  const another = await prepare(
    "20000000-0000-4000-8000-000000000011",
    other,
    cocoConversation,
  );
  assert.equal(another.error, "uncertain");
  await ingest([
    {
      ...event("m.late-echo", coco),
      direction: "outbound",
      client_request_id: uncertainRequest,
      text: "Reply from operator",
    },
  ]);
  assert.equal(
    (await prepare(uncertainRequest, other, cocoConversation)).message
      .delivery_state,
    "sent",
  );
});

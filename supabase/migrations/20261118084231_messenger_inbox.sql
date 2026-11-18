-- Apply to the selected inbox Supabase project. No tokens or raw webhook payloads are stored here.
create table public.messenger_pages (
  id text primary key check (id in ('500981746436108','651516738053247','109815532143585','103575287751558')),
  name text not null,
  last_send_error text,
  blocked_until timestamptz
);
insert into public.messenger_pages (id, name) values
  ('500981746436108','The Moringa Tree Restaurant El Nido'),
  ('651516738053247','Sa Kurbada Hapag Karaenan'),
  ('109815532143585','Coco Resto El Nido'),
  ('103575287751558','The LightHouse El Nido');

create table public.messenger_page_members (
  page_id text not null references public.messenger_pages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (page_id, user_id)
);
create index messenger_members_user_idx on public.messenger_page_members(user_id, page_id);

create table public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  page_id text not null references public.messenger_pages(id),
  customer_psid text not null check (customer_psid ~ '^[0-9]{1,64}$'),
  last_message_at timestamptz not null,
  last_inbound_at timestamptz,
  last_preview text not null default '',
  unique (page_id, customer_psid),
  unique (id, page_id)
);
create index messenger_conversations_page_time_idx on public.messenger_conversations(page_id, last_message_at desc, id);

create table public.messenger_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  page_id text not null,
  meta_message_id text,
  client_request_id uuid,
  direction text not null check (direction in ('inbound','outbound')),
  text text not null default '',
  attachment_types jsonb not null default '[]'::jsonb check (jsonb_typeof(attachment_types) = 'array'),
  sent_at timestamptz not null,
  delivery_state text not null check (delivery_state in ('received','pending','sent','failed','unknown')),
  error_code text,
  created_by uuid references auth.users(id) on delete set null,
  foreign key (conversation_id, page_id) references public.messenger_conversations(id, page_id) on delete cascade,
  unique (page_id, meta_message_id),
  unique (conversation_id, client_request_id)
);
create index messenger_messages_conversation_time_idx on public.messenger_messages(conversation_id, sent_at desc, id);
create index messenger_messages_page_idx on public.messenger_messages(page_id);
create index messenger_messages_unresolved_idx on public.messenger_messages(conversation_id) where delivery_state in ('pending','unknown');
create index messenger_messages_creator_idx on public.messenger_messages(created_by);

create table public.messenger_reads (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (conversation_id, user_id)
);
create index messenger_reads_user_idx on public.messenger_reads(user_id);

alter table public.messenger_pages enable row level security;
alter table public.messenger_page_members enable row level security;
alter table public.messenger_conversations enable row level security;
alter table public.messenger_messages enable row level security;
alter table public.messenger_reads enable row level security;

create policy members_read_self on public.messenger_page_members for select to authenticated using (user_id = (select auth.uid()));
create policy pages_read_member on public.messenger_pages for select to authenticated using (
  id in (select page_id from public.messenger_page_members where user_id = (select auth.uid()))
);
create policy conversations_read_member on public.messenger_conversations for select to authenticated using (
  page_id in (select page_id from public.messenger_page_members where user_id = (select auth.uid()))
);
create policy messages_read_member on public.messenger_messages for select to authenticated using (
  page_id in (select page_id from public.messenger_page_members where user_id = (select auth.uid()))
);
create policy reads_select_self on public.messenger_reads for select to authenticated using (
  user_id = (select auth.uid()) and conversation_id in (select id from public.messenger_conversations)
);
create policy reads_insert_self on public.messenger_reads for insert to authenticated with check (
  user_id = (select auth.uid()) and conversation_id in (select id from public.messenger_conversations)
);
create policy reads_update_self on public.messenger_reads for update to authenticated using (
  user_id = (select auth.uid()) and conversation_id in (select id from public.messenger_conversations)
) with check (
  user_id = (select auth.uid()) and conversation_id in (select id from public.messenger_conversations)
);

revoke all on public.messenger_pages, public.messenger_page_members, public.messenger_conversations, public.messenger_messages, public.messenger_reads from anon, authenticated;
grant select on public.messenger_pages, public.messenger_page_members, public.messenger_conversations, public.messenger_messages, public.messenger_reads to authenticated;
grant insert, update on public.messenger_reads to authenticated;
grant all on public.messenger_pages, public.messenger_page_members, public.messenger_conversations, public.messenger_messages, public.messenger_reads to service_role;

create function public.messenger_mark_read(conversation uuid, viewed_at timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare latest_inbound timestamptz;
begin
  -- RLS checks membership. Concurrent tabs cannot move a read watermark backwards.
  select last_inbound_at into latest_inbound from public.messenger_conversations where id = conversation;
  if latest_inbound is null or (select auth.uid()) is null then return false; end if;
  insert into public.messenger_reads(conversation_id,user_id,last_read_at)
    values(conversation,(select auth.uid()),least(viewed_at,latest_inbound))
    on conflict(conversation_id,user_id) do update set last_read_at = greatest(public.messenger_reads.last_read_at,excluded.last_read_at);
  return true;
end;
$$;
revoke all on function public.messenger_mark_read(uuid,timestamptz) from public, anon;
grant execute on function public.messenger_mark_read(uuid,timestamptz) to authenticated;

-- Every batch is a single transaction. Concurrent deliveries serialize per conversation.
create function public.messenger_ingest(events jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  e jsonb; c public.messenger_conversations; existing_id uuid;
  event_at timestamptz; inbound_at timestamptz; preview text;
begin
  for e in select value from jsonb_array_elements(events) loop
    if not exists (select 1 from public.messenger_pages where id = e->>'page_id') then continue; end if;
    event_at := (e->>'sent_at')::timestamptz;
    inbound_at := case when e->>'direction' = 'inbound' then least(event_at, clock_timestamp()) else null end;
    preview := left(coalesce(nullif(e->>'text',''), '[Attachment]'), 240);
    insert into public.messenger_conversations(page_id, customer_psid, last_message_at, last_inbound_at, last_preview)
      values (e->>'page_id', e->>'customer_psid', event_at, inbound_at, preview)
      on conflict (page_id, customer_psid) do nothing;
    select * into strict c from public.messenger_conversations where page_id = e->>'page_id' and customer_psid = e->>'customer_psid' for update;
    -- Echo metadata correlates an in-flight send even if the HTTP response has not arrived.
    existing_id := null;
    if e->>'direction' = 'outbound' and nullif(e->>'client_request_id','') is not null then
      select id into existing_id from public.messenger_messages
        where conversation_id = c.id and client_request_id = (e->>'client_request_id')::uuid and direction = 'outbound';
    end if;
    if existing_id is not null then
      -- A prior echo without metadata may already own this provider ID.
      delete from public.messenger_messages where page_id = c.page_id and meta_message_id = e->>'meta_message_id' and id <> existing_id and direction = 'outbound';
      update public.messenger_messages set meta_message_id = e->>'meta_message_id', delivery_state = 'sent', error_code = null, sent_at = event_at where id = existing_id;
    else
      insert into public.messenger_messages(conversation_id,page_id,meta_message_id,direction,text,attachment_types,sent_at,delivery_state)
        values(c.id,c.page_id,e->>'meta_message_id',e->>'direction',e->>'text',e->'attachment_types',event_at,case when e->>'direction' = 'inbound' then 'received' else 'sent' end)
        on conflict(page_id,meta_message_id) do nothing;
    end if;
    update public.messenger_conversations set
      last_preview = case when event_at >= last_message_at then preview else last_preview end,
      last_message_at = greatest(last_message_at,event_at),
      last_inbound_at = greatest(last_inbound_at,inbound_at)
      where id = c.id;
  end loop;
end;
$$;

-- Called only by the trusted backend, after getUser. Rechecks membership inside the transaction.
create function public.messenger_prepare_reply(operator_id uuid, conversation uuid, request_id uuid, reply_text text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare c public.messenger_conversations; p public.messenger_pages; m public.messenger_messages;
begin
  select * into c from public.messenger_conversations where id = conversation;
  if c.id is null or not exists (select 1 from public.messenger_page_members where page_id = c.page_id and user_id = operator_id) then
    return jsonb_build_object('error','forbidden');
  end if;
  -- Lock Page first, then conversation, consistently across send preparation/finalization.
  select * into strict p from public.messenger_pages where id = c.page_id for update;
  select * into strict c from public.messenger_conversations where id = conversation for update;
  select * into m from public.messenger_messages where conversation_id = c.id and client_request_id = request_id;
  if m.id is not null then
    if m.text <> reply_text then return jsonb_build_object('error','request_conflict'); end if;
    return jsonb_build_object('existing',true,'message',to_jsonb(m));
  end if;
  if c.last_inbound_at is null or c.last_inbound_at > clock_timestamp() or c.last_inbound_at + interval '24 hours' <= clock_timestamp() then return jsonb_build_object('error','window_closed'); end if;
  if p.blocked_until > clock_timestamp() then return jsonb_build_object('error','rate_limit'); end if;
  if exists (select 1 from public.messenger_messages where conversation_id = c.id and delivery_state in ('pending','unknown')) then return jsonb_build_object('error','uncertain'); end if;
  if length(btrim(reply_text)) = 0 or length(reply_text) > 2000 then return jsonb_build_object('error','invalid_text'); end if;
  insert into public.messenger_messages(conversation_id,page_id,client_request_id,direction,text,sent_at,delivery_state,created_by)
    values(c.id,c.page_id,request_id,'outbound',reply_text,clock_timestamp(),'pending',operator_id) returning * into m;
  return jsonb_build_object('existing',false,'message',to_jsonb(m));
end;
$$;

create function public.messenger_finish_reply(message uuid, result_state text, provider_id text default null, failure_code text default null, cooldown_seconds integer default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare m public.messenger_messages;
begin
  select * into strict m from public.messenger_messages where id = message;
  perform 1 from public.messenger_pages where id = m.page_id for update;
  perform 1 from public.messenger_conversations where id = m.conversation_id for update;
  select * into strict m from public.messenger_messages where id = message for update;
  -- An echo is stronger evidence than an ambiguous or failed HTTP response.
  if m.delivery_state = 'sent' then return to_jsonb(m); end if;
  if result_state not in ('sent','failed','unknown') or (result_state = 'sent' and provider_id is null) then raise exception 'Invalid send outcome'; end if;
  if result_state = 'sent' then
    delete from public.messenger_messages where page_id = m.page_id and meta_message_id = provider_id and id <> m.id and direction = 'outbound';
  end if;
  update public.messenger_messages set delivery_state = result_state, meta_message_id = provider_id, error_code = failure_code where id = m.id returning * into m;
  update public.messenger_pages set last_send_error = failure_code,
    blocked_until = case when failure_code = 'rate_limit' then clock_timestamp() + make_interval(secs => least(greatest(coalesce(cooldown_seconds,60),1),86400)) else null end where id = m.page_id;
  if result_state = 'sent' then
    update public.messenger_conversations set last_preview = case when m.sent_at >= last_message_at then left(m.text,240) else last_preview end,
      last_message_at = greatest(last_message_at,m.sent_at) where id = m.conversation_id;
  end if;
  return to_jsonb(m);
end;
$$;

-- No privileged definer functions; the service key is the only role allowed to execute mutations.
revoke all on function public.messenger_ingest(jsonb) from public, anon, authenticated;
revoke all on function public.messenger_prepare_reply(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.messenger_finish_reply(uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.messenger_ingest(jsonb), public.messenger_prepare_reply(uuid,uuid,uuid,text), public.messenger_finish_reply(uuid,text,text,text,integer) to service_role;

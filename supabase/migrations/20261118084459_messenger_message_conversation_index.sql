-- Cover both columns of the conversation foreign key for cascades and lookups.
create index messenger_messages_conversation_page_idx
  on public.messenger_messages (conversation_id, page_id);

-- Names are cached by the server after an authorized operator loads the inbox.
-- Existing Page membership policies and service-only writes remain in force.
alter table public.messenger_conversations
  add column customer_name text
    check (customer_name is null or
      (char_length(customer_name) between 1 and 200 and btrim(customer_name) <> '')),
  add column profile_checked_at timestamptz;

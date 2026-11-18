export type DeliveryState =
  "received" | "pending" | "sent" | "failed" | "unknown";
export type Conversation = {
  id: string;
  page_id: string;
  customer_psid: string;
  last_message_at: string;
  last_inbound_at: string | null;
  last_preview: string;
};
export type Message = {
  id: string;
  conversation_id: string;
  page_id: string;
  meta_message_id: string | null;
  client_request_id: string | null;
  direction: "inbound" | "outbound";
  text: string;
  attachment_types: string[];
  sent_at: string;
  delivery_state: DeliveryState;
  error_code: string | null;
};
export type InboxPage = {
  id: string;
  name: string;
  last_send_error: string | null;
  blocked_until: string | null;
};
export type NormalizedMessage = {
  page_id: string;
  customer_psid: string;
  meta_message_id: string;
  direction: "inbound" | "outbound";
  text: string;
  attachment_types: string[];
  sent_at: string;
  client_request_id: string | null;
};

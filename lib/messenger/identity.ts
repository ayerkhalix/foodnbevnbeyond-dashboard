export function conversationName(conversation: {
  customer_name?: string | null;
}) {
  return conversation.customer_name?.trim() || "Messenger user";
}

export function conversationInitials(conversation: {
  customer_name?: string | null;
}) {
  const name = conversation.customer_name?.trim();
  if (!name) return "?";
  const words = name.split(/\s+/u);
  const initials = [
    words[0],
    ...(words.length > 1 ? [words[words.length - 1]] : []),
  ]
    .map((word) => Array.from(word)[0])
    .join("");
  return initials.toLocaleUpperCase("en-PH");
}

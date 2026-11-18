export function replyWindowOpen(lastInbound: string | null, now = Date.now()) {
  const timestamp = lastInbound ? Date.parse(lastInbound) : NaN;
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now &&
    now < timestamp + 86_400_000
  );
}

export function sendErrorText(code: string | null) {
  switch (code) {
    case "window_closed":
      return "The 24-hour reply window has closed. Wait for the guest to message again.";
    case "token":
      return "This restaurant needs its Messenger access reconnected. Your draft is kept in this tab.";
    case "permission":
      return "Messenger access for this restaurant needs attention. Your draft is kept in this tab.";
    case "rate_limit":
      return "Messenger is limiting replies for this restaurant. Try again later.";
    case "unavailable":
      return "Messenger cannot deliver to this guest right now. Your draft is kept in this tab.";
    case "not_configured":
      return "Messenger replies are not set up for this restaurant yet.";
    case "uncertain":
      return "Delivery is unconfirmed. Check Messenger before sending again. Your draft is kept in this tab.";
    default:
      return "Messenger could not send this reply. Your draft is kept in this tab.";
  }
}

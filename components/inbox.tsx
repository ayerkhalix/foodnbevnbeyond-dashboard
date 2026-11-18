"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  RefreshCw,
  Search,
  Send,
  Sun,
  X,
} from "lucide-react";
import { browserSupabase } from "@/lib/supabase/client";
import { PAGES, pageFor } from "@/lib/messenger/pages";
import { replyWindowOpen, sendErrorText } from "@/lib/messenger/graph-client";
import {
  conversationInitials,
  conversationName,
} from "@/lib/messenger/identity";
import type { Conversation, InboxPage, Message } from "@/lib/messenger/types";
import { LoginForm } from "./login-form";

type InboxData = {
  conversations: Conversation[];
  pages: InboxPage[];
  reads: { conversation_id: string; last_read_at: string }[];
  next: number | null;
};
type ThreadData = {
  conversation: Conversation;
  messages: Message[];
  next: number | null;
};
type Draft = {
  text: string;
  requestId?: string;
  uncertain?: boolean;
  error?: string;
  sending?: boolean;
};

const timeFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  year: "numeric",
});
function Avatar({ initials = "?" }: { initials?: string }) {
  return (
    <div className="avatar" aria-hidden="true">
      {initials}
    </div>
  );
}

function BusinessBadge({ id }: { id: string }) {
  const page = pageFor(id);
  if (!page) return null;
  return (
    <span className={`business-badge ${page.color}`}>
      <img src={page.logo} alt="" />
      <span className="business-badge-label">{page.name}</span>
    </span>
  );
}

function mergeMessages(existing: Message[], incoming: Message[]) {
  const byId = new Map(existing.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  const byProvider = new Map<string, Message>();
  for (const message of byId.values()) {
    const key = message.meta_message_id
      ? `${message.page_id}:${message.meta_message_id}`
      : message.id;
    const previous = byProvider.get(key);
    if (!previous || message.client_request_id || !previous.client_request_id)
      byProvider.set(key, message);
  }
  return [...byProvider.values()].sort(
    (a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id),
  );
}

export function Inbox({ operatorName }: { operatorName: string }) {
  const [data, setData] = useState<InboxData>({
    conversations: [],
    pages: [],
    reads: [],
    next: null,
  });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState("");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dark, setDark] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [olderLoading, setOlderLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const selectionRef = useRef(selected);
  const listRequest = useRef<AbortController | null>(null);
  const threadRequest = useRef<AbortController | null>(null);
  const sendLock = useRef(new Set<string>());
  const searchInput = useRef<HTMLInputElement>(null);
  const chatBody = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectionRef.current = selected;
  }, [selected]);
  useEffect(() => {
    try {
      setDark(localStorage.getItem("food-n-bev-theme") === "dark");
    } catch {
      /* Optional preference. */
    }
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const checkResponse = useCallback(async (response: Response) => {
    if (response.status === 401) setSessionExpired(true);
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        body.error || "The inbox could not be reached. Try again.",
      );
    return body;
  }, []);

  const loadInbox = useCallback(
    async (offset = 0, background = false) => {
      if (background && listRequest.current) return;
      listRequest.current?.abort();
      const controller = new AbortController();
      listRequest.current = controller;
      if (!background) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filter) params.set("page", filter);
        if (offset) params.set("before", String(offset));
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15_000),
        ]);
        const result: InboxData = await checkResponse(
          await fetch(`/api/inbox?${params}`, { signal, cache: "no-store" }),
        );
        if (controller.signal.aborted) return;
        setData((previous) =>
          offset
            ? {
                ...result,
                conversations: [
                  ...new Map(
                    [...previous.conversations, ...result.conversations].map(
                      (item) => [item.id, item],
                    ),
                  ).values(),
                ],
                reads: [
                  ...new Map(
                    [...previous.reads, ...result.reads].map((item) => [
                      item.conversation_id,
                      item,
                    ]),
                  ).values(),
                ],
              }
            : result,
        );
        setLoaded(true);
        setLoadError("");
      } catch (error) {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error
              ? error.message
              : "The inbox could not load.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
        if (listRequest.current === controller) listRequest.current = null;
      }
    },
    [filter, checkResponse],
  );

  const loadThread = useCallback(
    async (id: string, background = false) => {
      if (background && threadRequest.current) return;
      threadRequest.current?.abort();
      const controller = new AbortController();
      threadRequest.current = controller;
      if (!background) setThreadLoading(true);
      try {
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15_000),
        ]);
        const result: ThreadData = await checkResponse(
          await fetch(`/api/inbox/${id}`, { signal, cache: "no-store" }),
        );
        if (controller.signal.aborted || selectionRef.current !== id) return;
        setThread((previous) =>
          previous?.conversation.id === id
            ? {
                ...result,
                messages: mergeMessages(previous.messages, result.messages),
                next:
                  previous.messages.length > 50 ? previous.next : result.next,
              }
            : result,
        );
        setThreadError("");
        setDrafts((previous) => {
          const draft = previous[id];
          const match =
            draft?.requestId &&
            result.messages.find(
              (message) => message.client_request_id === draft.requestId,
            );
          if (!draft || !match || match.delivery_state !== "sent")
            return previous;
          return {
            ...previous,
            [id]: { text: draft.text === match.text ? "" : draft.text },
          };
        });
        if (
          result.conversation.last_inbound_at &&
          document.visibilityState === "visible"
        ) {
          const lastReadAt = result.conversation.last_inbound_at;
          const response = await fetch(`/api/inbox/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lastReadAt }),
            signal: controller.signal,
          });
          if (response.ok && !controller.signal.aborted) {
            setData((previous) => ({
              ...previous,
              reads: [
                ...previous.reads.filter((read) => read.conversation_id !== id),
                { conversation_id: id, last_read_at: lastReadAt },
              ],
            }));
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setThreadError(
            error instanceof Error
              ? error.message
              : "The conversation could not load.",
          );
          if (!background) setThread(null);
        }
      } finally {
        if (!controller.signal.aborted) setThreadLoading(false);
        if (threadRequest.current === controller) threadRequest.current = null;
      }
    },
    [checkResponse],
  );

  useEffect(() => {
    setLoaded(false);
    void loadInbox();
    return () => listRequest.current?.abort();
  }, [loadInbox]);

  useEffect(() => {
    if (!selected) {
      setThread(null);
      return;
    }
    selectionRef.current = selected;
    autoScroll.current = true;
    setThread(null);
    setThreadError("");
    void loadThread(selected);
    return () => threadRequest.current?.abort();
  }, [selected, loadThread]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || sessionExpired) return;
      if (data.conversations.length <= 50) void loadInbox(0, true);
      if (selectionRef.current) void loadThread(selectionRef.current, true);
    };
    const timer = setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadInbox, loadThread, sessionExpired, data.conversations.length]);

  useEffect(() => {
    if (autoScroll.current && chatBody.current)
      chatBody.current.scrollTop = chatBody.current.scrollHeight;
  }, [thread?.messages]);

  const reads = useMemo(
    () =>
      new Map(
        data.reads.map((read) => [read.conversation_id, read.last_read_at]),
      ),
    [data.reads],
  );
  const unread = useCallback(
    (conversation: Conversation) =>
      Boolean(
        conversation.last_inbound_at &&
        conversation.last_inbound_at > (reads.get(conversation.id) || ""),
      ),
    [reads],
  );
  const filtered = useMemo(
    () =>
      data.conversations.filter((conversation) =>
        `${conversationName(conversation)} ${conversation.customer_psid} ${conversation.last_preview} ${pageFor(conversation.page_id)?.name}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [data.conversations, query],
  );
  const conversation = thread?.conversation;
  const draft = selected ? drafts[selected] || { text: "" } : { text: "" };
  const windowOpen = conversation
    ? replyWindowOpen(conversation.last_inbound_at, clock)
    : false;
  const pageState = data.pages.find(
    (page) => page.id === conversation?.page_id,
  );
  const rateLimited = Boolean(
    pageState?.blocked_until && Date.parse(pageState.blocked_until) > clock,
  );
  const unresolved = Boolean(
    thread?.messages.some((message) =>
      ["pending", "unknown"].includes(message.delivery_state),
    ),
  );
  const sendDisabled =
    !windowOpen ||
    rateLimited ||
    draft.sending ||
    unresolved ||
    draft.uncertain ||
    sessionExpired ||
    Boolean(threadError);

  function updateDraft(text: string) {
    if (!selected) return;
    setDrafts((previous) => {
      const current = previous[selected] || { text: "" };
      return {
        ...previous,
        [selected]: {
          ...current,
          text,
          ...(!current.uncertain && !current.sending
            ? { requestId: undefined, error: undefined }
            : {}),
        },
      };
    });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      !selected ||
      !conversation ||
      !draft.text.trim() ||
      sendDisabled ||
      sendLock.current.has(selected)
    )
      return;
    const id = selected,
      text = draft.text.trim(),
      requestId = draft.requestId || crypto.randomUUID();
    sendLock.current.add(id);
    setDrafts((previous) => ({
      ...previous,
      [id]: {
        ...previous[id],
        text,
        requestId,
        sending: true,
        error: undefined,
      },
    }));
    try {
      const response = await fetch(`/api/inbox/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, requestId }),
        signal: AbortSignal.timeout(25_000),
      });
      if (response.status === 401) setSessionExpired(true);
      const result = await response.json();
      if (selectionRef.current === id && result.message)
        setThread(
          (previous) =>
            previous && {
              ...previous,
              messages: mergeMessages(previous.messages, [result.message]),
            },
        );
      const outcome = result.outcome;
      setDrafts((previous) => ({
        ...previous,
        [id]:
          outcome === "sent"
            ? { text: "" }
            : {
                text,
                requestId:
                  outcome === "failed" ||
                  outcome === "not_sent" ||
                  response.status === 401
                    ? undefined
                    : requestId,
                uncertain:
                  !["failed", "not_sent"].includes(outcome) &&
                  response.status !== 401,
                error:
                  result.error ||
                  sendErrorText(result.message?.error_code || "uncertain"),
              },
      }));
      autoScroll.current = true;
      void loadInbox(0, true);
      if (selectionRef.current === id) void loadThread(id, true);
    } catch {
      setDrafts((previous) => ({
        ...previous,
        [id]: {
          text,
          requestId,
          uncertain: true,
          error: sendErrorText("uncertain"),
        },
      }));
    } finally {
      sendLock.current.delete(id);
    }
  }

  async function olderMessages() {
    if (!selected || thread?.next == null || olderLoading) return;
    const id = selected,
      offset = thread.next;
    setOlderLoading(true);
    try {
      const result: ThreadData = await checkResponse(
        await fetch(`/api/inbox/${id}?before=${offset}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        }),
      );
      if (selectionRef.current === id)
        setThread((previous) =>
          previous
            ? {
                ...previous,
                messages: mergeMessages(previous.messages, result.messages),
                next: result.next,
              }
            : previous,
        );
    } catch (error) {
      if (selectionRef.current === id)
        setThreadError(
          error instanceof Error
            ? error.message
            : "Earlier messages could not load.",
        );
    } finally {
      setOlderLoading(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      const { error } = await browserSupabase().auth.signOut();
      if (error) throw error;
      window.location.assign("/login");
    } catch {
      setLoadError("Sign-out failed. Try again.");
      setSigningOut(false);
    }
  }

  function selectPage(id: string) {
    setFilter(id);
    setSelected(null);
    setQuery("");
    setMobileChat(false);
    setMenuOpen(false);
    menuButton.current?.focus();
  }

  return (
    <div className={`messaging-app ${dark ? "dark" : ""}`}>
      <button
        ref={menuButton}
        className="mobile-menu"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-controls="restaurant-navigation"
        aria-label="Show restaurants"
      >
        <Menu />
      </button>
      <div
        className={`sidebar-container ${menuOpen ? "is-open" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setMenuOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <aside
          id="restaurant-navigation"
          className="businesses-panel"
          aria-label="Restaurants"
        >
          <div className="brand">
            <img
              className="brand-logo"
              src="/food%20n%20bev%20transparent.png"
              alt=""
            />
            <div>
              <strong>FOOD N BEV & BEYOND</strong>
              <small>CORPORATION</small>
            </div>
            <button
              className="close-mobile"
              onClick={() => {
                setMenuOpen(false);
                menuButton.current?.focus();
              }}
              aria-label="Close restaurants"
            >
              <X />
            </button>
          </div>
          <div className="businesses-title">RESTAURANTS</div>
          <button
            className={`business-link ${!filter ? "selected" : ""}`}
            aria-pressed={!filter}
            onClick={() => selectPage("")}
          >
            <MessageCircle />
            <span>All messages</span>
          </button>
          <div className="business-list">
            {PAGES.filter((page) =>
              data.pages.some((allowed) => allowed.id === page.id),
            ).map((page) => (
              <button
                key={page.id}
                className={`business-link ${page.color} ${filter === page.id ? "selected" : ""}`}
                aria-pressed={filter === page.id}
                onClick={() => selectPage(page.id)}
              >
                <span className="business-icon">
                  <img src={page.logo} alt="" />
                </span>
                <span className="business-name">{page.name}</span>
              </button>
            ))}
          </div>
          <div className="panel-footer">
            <div className="profile">
              <Avatar initials={operatorName.slice(0, 2).toUpperCase()} />
              <span>
                <strong>{operatorName}</strong>
                <small>Restaurant messaging</small>
              </span>
            </div>
            <button
              className="signout-button"
              onClick={signOut}
              disabled={signingOut}
            >
              <LogOut size={16} />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </aside>
      </div>
      <main className="messaging-main">
        <header className="topbar">
          <div>
            <h2>Restaurant inbox</h2>
            <div className="inbox-status">
              <span />
              {loaded
                ? "Refreshes every 10 seconds"
                : "Connecting to your inbox…"}
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="theme-toggle"
              onClick={() => {
                setDark((value) => !value);
                try {
                  localStorage.setItem(
                    "food-n-bev-theme",
                    dark ? "light" : "dark",
                  );
                } catch {
                  /* Optional preference. */
                }
              }}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? <Sun /> : <Moon />}
            </button>
            <button
              className="theme-toggle"
              aria-label="Refresh inbox"
              title="Refresh inbox"
              onClick={() => {
                void loadInbox();
                if (selected) void loadThread(selected, true);
              }}
              disabled={loading}
            >
              <RefreshCw />
            </button>
          </div>
        </header>
        {sessionExpired && (
          <div className="session-recovery">
            <h2>Sign in to continue</h2>
            <p>Your drafts are kept in this tab.</p>
            <LoginForm
              configured
              onSuccess={() => {
                setSessionExpired(false);
                void loadInbox();
                if (selected) void loadThread(selected, true);
              }}
            />
          </div>
        )}
        <div
          className={`messaging-workspace ${mobileChat ? "view-chat" : "view-conversations"}`}
        >
          <section
            className="conversation-panel"
            aria-label="Conversations"
            aria-busy={loading}
          >
            <header className="conversation-header">
              <div>
                <h1>{filter ? pageFor(filter)?.short : "All messages"}</h1>
                <p>
                  {loaded && data.pages.length === 0
                    ? "Access is awaiting assignment"
                    : "Guest conversations on Messenger"}
                </p>
              </div>
              <span
                className="message-count"
                aria-label={`${data.conversations.length} loaded conversations`}
              >
                {data.conversations.length}
              </span>
            </header>
            <div className="search-box">
              <Search />
              <input
                ref={searchInput}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search loaded conversations…"
                aria-label="Search loaded conversations"
              />
              {query && (
                <button
                  className="clear-search"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    searchInput.current?.focus();
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="conversation-list">
              {loadError && (
                <div className="inline-notice" role="status">
                  <p>{loadError}</p>
                  <button onClick={() => void loadInbox()}>Try again</button>
                </div>
              )}
              {!loaded && !loadError && (
                <p className="empty-small" role="status">
                  Loading conversations…
                </p>
              )}
              {loaded &&
                filtered.map((item) => (
                  <button
                    key={item.id}
                    className={`conversation-item ${selected === item.id ? "selected" : ""}`}
                    aria-pressed={selected === item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setMobileChat(true);
                    }}
                  >
                    <Avatar initials={conversationInitials(item)} />
                    <span className="conversation-content">
                      <span className="conversation-top">
                        <strong>{conversationName(item)}</strong>
                        <time dateTime={item.last_message_at}>
                          {dateFormat.format(new Date(item.last_message_at))}
                        </time>
                      </span>
                      <BusinessBadge id={item.page_id} />
                      <span className="preview">{item.last_preview}</span>
                    </span>
                    {unread(item) && (
                      <i className="unread-dot" aria-label="Unread messages" />
                    )}
                  </button>
                ))}
              {loaded && filtered.length === 0 && (
                <div className="empty-small">
                  {query
                    ? "No loaded conversations match your search."
                    : data.pages.length === 0
                      ? "Ask your administrator to assign your restaurant access."
                      : "New guest messages will appear here once Messenger is connected."}
                </div>
              )}
              {data.next !== null && (
                <button
                  className="load-more"
                  disabled={loading}
                  onClick={() => void loadInbox(data.next!)}
                >
                  {loading ? "Loading…" : "Load more conversations"}
                </button>
              )}
            </div>
          </section>
          <section
            className="chat-panel"
            aria-label="Selected conversation"
            aria-busy={threadLoading}
          >
            {!conversation ? (
              <div className="thread-placeholder">
                <button
                  className="back-button"
                  onClick={() => setMobileChat(false)}
                >
                  <ArrowLeft />
                  Back
                </button>
                <MessageCircle size={32} />
                <h2>
                  {threadLoading
                    ? "Loading conversation…"
                    : "Your restaurants, one inbox"}
                </h2>
                <p>
                  {threadError ||
                    "Choose a guest conversation to read and reply."}
                </p>
                {threadError && selected && (
                  <button
                    className="load-more"
                    onClick={() => void loadThread(selected)}
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <>
                <header className="chat-header">
                  <button
                    className="back-button"
                    onClick={() => setMobileChat(false)}
                  >
                    <ArrowLeft />
                    Back
                  </button>
                  <div className="chat-person">
                    <Avatar initials={conversationInitials(conversation)} />
                    <div className="chat-identity">
                      <h2>{conversationName(conversation)}</h2>
                      <p>Facebook Messenger</p>
                      <BusinessBadge id={conversation.page_id} />
                    </div>
                  </div>
                </header>
                <div
                  ref={chatBody}
                  className="chat-body"
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    autoScroll.current =
                      element.scrollHeight -
                        element.scrollTop -
                        element.clientHeight <
                      100;
                  }}
                >
                  {thread?.next != null && (
                    <button
                      className="load-more"
                      disabled={olderLoading}
                      onClick={olderMessages}
                    >
                      {olderLoading ? "Loading…" : "Load earlier messages"}
                    </button>
                  )}
                  {threadError && (
                    <div className="inline-notice" role="status">
                      <p>{threadError}</p>
                      <button
                        onClick={() => void loadThread(conversation.id, true)}
                      >
                        Try again
                      </button>
                    </div>
                  )}
                  <p className="thread-timezone">
                    Times shown in Philippine time
                  </p>
                  {thread?.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`message-bubble-row ${message.direction === "inbound" ? "customer" : "staff"}`}
                    >
                      <div className="message-bubble">
                        <p>
                          {message.text ||
                            `[${message.attachment_types.join(", ") || "Unsupported"} attachment]`}
                        </p>
                        {message.text &&
                          message.attachment_types.length > 0 && (
                            <p className="attachment-note">
                              {message.attachment_types.join(", ")} attachment
                              received
                            </p>
                          )}
                        <time dateTime={message.sent_at}>
                          {dateFormat.format(new Date(message.sent_at))} ·{" "}
                          {timeFormat.format(new Date(message.sent_at))}
                        </time>
                        {message.direction === "outbound" && (
                          <span className="delivery-state">
                            {
                              {
                                pending: "Awaiting confirmation",
                                sent: "Sent",
                                failed: "Not sent",
                                unknown: "Delivery unconfirmed",
                                received: "Received",
                              }[message.delivery_state]
                            }
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="reply-status" role="status">
                  {draft.error ||
                    (unresolved || draft.uncertain
                      ? "A reply is awaiting confirmation. Check Messenger before sending again."
                      : !windowOpen
                        ? "The 24-hour reply window is closed. A new guest message will reopen it."
                        : rateLimited
                          ? "Messenger is limiting replies for this restaurant. Try again later."
                          : `Replying as ${pageFor(conversation.page_id)?.name}`)}
                </div>
                <form className="composer" noValidate onSubmit={send}>
                  <label className="sr-only" htmlFor="reply-text">
                    Reply to guest
                  </label>
                  <textarea
                    id="reply-text"
                    value={draft.text}
                    disabled={draft.sending}
                    maxLength={2000}
                    onChange={(event) => updateDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing &&
                        event.keyCode !== 229
                      ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder="Type your reply…"
                    aria-describedby="composer-help"
                  />
                  <button
                    className="send-button"
                    type="submit"
                    disabled={sendDisabled || !draft.text.trim()}
                    aria-busy={draft.sending}
                    aria-label={draft.sending ? "Sending reply" : "Send reply"}
                  >
                    <Send />
                    <span>{draft.sending ? "Sending…" : "Send"}</span>
                  </button>
                </form>
                <p id="composer-help" className="composer-help">
                  {draft.text.length}/2,000 · Shift + Enter for a new line
                </p>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

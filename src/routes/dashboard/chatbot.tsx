import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useCallback, useRef, useEffect } from "react";
import { callChatAI, MissingApiKeyError, RateLimitError } from "~/ai";
import { sql } from "~/db";
import { getSessionFromRequest } from "~/auth";
import { getStartContext } from "@tanstack/start-storage-context";

const sendChatMessage = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null) throw new Error("Conversation and message are required");
    const { conversationId, message } = data as { conversationId?: string; message?: string };
    if (!conversationId || !message?.trim()) throw new Error("Conversation and message are required");
    const id = Number(conversationId);
    if (!Number.isInteger(id) || id < 1) throw new Error("Invalid conversation");
    if (message.trim().length > 4000) throw new Error("Message is too long");
    return { conversationId: id, message: message.trim() };
  })
  .handler(async ({ data }) => {
    let userId: number | null = null;
    try {
      const ctx = getStartContext();
      if (ctx?.request) {
        const session = getSessionFromRequest(ctx.request);
        if (session) userId = session.userId;
      }
    } catch { /* anonymous chat is still allowed */ }

    try {
      const historyRows = userId
        ? await sql`SELECT role, content FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.conversation_id = ${data.conversationId} AND c.user_id = ${userId} ORDER BY m.created_at DESC LIMIT 20`
        : [];
      const history = [...historyRows].reverse()
        .filter((row: any) => row.role === "customer" || row.role === "owner" || row.role === "ai")
        .map((row: any) => ({ role: row.role === "ai" || row.role === "owner" ? "assistant" as const : "user" as const, content: row.content }));
      history.push({ role: "user", content: data.message });
      const response = await callChatAI(history);

      if (userId) {
        await sql`INSERT INTO messages (conversation_id, role, content) SELECT ${data.conversationId}, 'customer', ${data.message} WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ${data.conversationId} AND user_id = ${userId})`;
        await sql`INSERT INTO messages (conversation_id, role, content) SELECT ${data.conversationId}, 'ai', ${response} WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ${data.conversationId} AND user_id = ${userId})`;
      }
      return { response };
    } catch (err: any) {
      console.error("Chatbot AI error:", err?.message || err);
      if (err instanceof MissingApiKeyError) return { error: "API key not configured. Please set ANTHROPIC_API_KEY to enable the AI chatbot." };
      if (err instanceof RateLimitError) return { error: "We're receiving too many requests right now. Please wait a moment and try again." };
      return { error: "We couldn't send that message right now. Please try again." };
    }
  });

/* ── Types ─────────────────────────────────────────────────────────── */
type Status = "Waiting" | "Resolved" | "Active";

interface Message {
  id: string;
  sender: "customer" | "ai" | "system";
  text: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  customerName: string;
  car: string;
  phone: string;
  email: string;
  lastMessage: string;
  timestamp: string;
  status: Status;
  messages: Message[];
}

/* ── Mock Data ─────────────────────────────────────────────────────── */
const mockConversations: Conversation[] = [
  {
    id: "1",
    customerName: "Sarah Chen",
    car: "2021 Honda Accord",
    phone: "(555) 0123",
    email: "sarah.chen@email.com",
    lastMessage: "When will my car be ready?",
    timestamp: "10m ago",
    status: "Waiting",
    messages: [
      {
        id: "m1",
        sender: "customer",
        text: "Hi, I dropped off my 2021 Honda Accord this morning for the front bumper repair. Just wondering when it might be ready?",
        timestamp: "10m ago",
      },
      {
        id: "m2",
        sender: "ai",
        text: "Hi Sarah! Your Accord is currently in the paint booth. The bumper has been replaced and primed, and we're applying the color coat now. Based on the current progress, it should be ready for pickup tomorrow by 3:00 PM. I'll send you a confirmation in the morning once the clear coat is cured!",
        timestamp: "8m ago",
      },
      {
        id: "m3",
        sender: "customer",
        text: "Oh that's great, thank you! Will you text me?",
        timestamp: "6m ago",
      },
      {
        id: "m4",
        sender: "ai",
        text: "Yes! You'll get an automated text tomorrow morning with the exact pickup time. Is the phone number we have on file still (555) 0123?",
        timestamp: "5m ago",
      },
      {
        id: "m5",
        sender: "customer",
        text: "Yes that's correct. Thanks so much!",
        timestamp: "4m ago",
      },
    ],
  },
  {
    id: "2",
    customerName: "Mike Rodriguez",
    car: "2019 Ford F-150",
    phone: "(555) 2345",
    email: "mike.rod@email.com",
    lastMessage: "Can you explain what LKQ means?",
    timestamp: "1h ago",
    status: "Resolved",
    messages: [
      {
        id: "m6",
        sender: "customer",
        text: "Can you explain what LKQ means on my estimate?",
        timestamp: "1h ago",
      },
      {
        id: "m7",
        sender: "ai",
        text: "Of course, Mike! LKQ stands for 'Like Kind and Quality.' It means we're using a high-quality used or aftermarket part that matches the original in fit, function, and appearance — a great way to keep costs down without sacrificing quality.",
        timestamp: "55m ago",
      },
      {
        id: "m8",
        sender: "customer",
        text: "Got it, that makes sense. Thanks!",
        timestamp: "50m ago",
      },
    ],
  },
  {
    id: "3",
    customerName: "Jessica Park",
    car: "2023 Toyota Camry",
    phone: "(555) 3456",
    email: "jpark@email.com",
    lastMessage: "I need to reschedule my appointment",
    timestamp: "5m ago",
    status: "Waiting",
    messages: [
      {
        id: "m9",
        sender: "customer",
        text: "I need to reschedule my appointment for tomorrow. Something came up at work.",
        timestamp: "5m ago",
      },
    ],
  },
  {
    id: "4",
    customerName: "David Kim",
    car: "2020 BMW 3 Series",
    phone: "(555) 4567",
    email: "david.kim@email.com",
    lastMessage: "Is my insurance covering this?",
    timestamp: "2h ago",
    status: "Active",
    messages: [
      {
        id: "m10",
        sender: "customer",
        text: "Is my insurance covering the full repair?",
        timestamp: "2h ago",
      },
      {
        id: "m11",
        sender: "ai",
        text: "Hi David! Your insurance (GEICO) has approved the repair estimate. They're covering everything except your $500 deductible. We'll handle all the paperwork directly with them.",
        timestamp: "1h ago",
      },
      {
        id: "m12",
        sender: "customer",
        text: "Okay, and how much longer will the repair take?",
        timestamp: "55m ago",
      },
    ],
  },
  {
    id: "5",
    customerName: "Amanda Torres",
    car: "2022 Subaru Outback",
    phone: "(555) 5678",
    email: "amanda.t@email.com",
    lastMessage: "Thank you, that helps!",
    timestamp: "3h ago",
    status: "Resolved",
    messages: [
      {
        id: "m13",
        sender: "customer",
        text: "Can you send me a copy of the final invoice?",
        timestamp: "3h ago",
      },
      {
        id: "m14",
        sender: "ai",
        text: "Absolutely! I've emailed the final invoice to amanda.t@email.com. It includes the detailed breakdown of all work performed on your Outback.",
        timestamp: "2h ago",
      },
      {
        id: "m15",
        sender: "customer",
        text: "Thank you, that helps!",
        timestamp: "2h ago",
      },
    ],
  },
];

const QUICK_REPLIES = [
  "It'll be ready by...",
  "Let me check on that",
  "Your estimate breakdown:",
];

/* ── Helpers ───────────────────────────────────────────────────────── */
const statusBadgeClasses: Record<Status, string> = {
  Waiting: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Resolved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Active: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* ── Page route ────────────────────────────────────────────────────── */
export const Route = createFileRoute("/dashboard/chatbot")({
  component: ChatbotPage,
});

/* ── Page component ────────────────────────────────────────────────── */
function ChatbotPage() {
  const [conversations] = useState<Conversation[]>(mockConversations);
  const [selectedId, setSelectedId] = useState<string>("1");
  const [searchQuery, setSearchQuery] = useState("");
  const [convMessages, setConvMessages] = useState<Record<string, Message[]>>(() => {
    const seed: Record<string, Message[]> = {};
    mockConversations.forEach((c) => {
      seed[c.id] = [...c.messages];
    });
    return seed;
  });
  const [messageInput, setMessageInput] = useState("");
  const [isLoadingConv, setIsLoadingConv] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [showMobileChat, setShowMobileChat] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Derived ──────────────────────────────────────────────────── */
  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;
  const selectedMessages = selectedId ? convMessages[selectedId] ?? [] : [];

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.customerName.toLowerCase().includes(q) ||
      c.car.toLowerCase().includes(q) ||
      c.lastMessage.toLowerCase().includes(q)
    );
  });

  /* ── Effects ──────────────────────────────────────────────────── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedMessages, selectedId]);

  /* ── Handlers ─────────────────────────────────────────────────── */
  const handleSelectConversation = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      setIsLoadingConv(true);
      setSelectedId(id);
      setShowMobileChat(true);
      // Brief artificial delay for the loading pulse
      setTimeout(() => setIsLoadingConv(false), 300);
    },
    [selectedId],
  );

  const handleSendMessage = useCallback(async () => {
    const text = messageInput.trim();
    if (!text || !selectedId || isSending) return;
    const optimistic: Message = { id: `msg-${Date.now()}`, sender: "customer", text, timestamp: formatTime() };
    setConvMessages((prev) => ({ ...prev, [selectedId]: [...(prev[selectedId] ?? []), optimistic] }));
    setMessageInput("");
    setSendError("");
    setIsSending(true);
    try {
      const data = await sendChatMessage({ data: { conversationId: selectedId, message: text } });
      if ("error" in data) {
        setSendError(data.error);
        setConvMessages((prev) => ({ ...prev, [selectedId]: (prev[selectedId] ?? []).filter((m) => m.id !== optimistic.id) }));
      } else {
        setConvMessages((prev) => ({ ...prev, [selectedId]: [...(prev[selectedId] ?? []), { id: `ai-${Date.now()}`, sender: "ai", text: data.response, timestamp: formatTime() }] }));
      }
    } catch {
      setSendError("We couldn't send that message right now. Please try again.");
      setConvMessages((prev) => ({ ...prev, [selectedId]: (prev[selectedId] ?? []).filter((m) => m.id !== optimistic.id) }));
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }, [messageInput, selectedId, isSending]);

  const handleQuickReply = useCallback((reply: string) => {
    setMessageInput(reply);
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleBackToList = useCallback(() => {
    setShowMobileChat(false);
  }, []);

  /* ── Current view for mobile ──────────────────────────────────── */
  const showList = !showMobileChat;
  const showChat = showMobileChat || true; // always true on desktop (rendered inline)

  return (
    <div className="flex h-full -m-4 sm:-m-6 lg:-m-8">
      {/* ── Left panel: Conversation list ──────────────────────────── */}
      <div
        className={`${
          showList ? "flex" : "hidden"
        } lg:flex flex-col w-full lg:w-[30%] lg:min-w-[320px] border-r border-slate-700 bg-slate-800/50`}
      >
        {/* Header */}
        <div className="px-4 py-4 border-b border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-white">Conversations</h1>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 transition"
              aria-label="New conversation"
            >
              <PlusIcon />
              New
            </button>
          </div>
          {/* Search */}
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full rounded-lg border border-slate-600 bg-slate-800 pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="text-4xl mb-3 opacity-40">🔍</div>
              <p className="text-sm text-slate-400">No conversations match your search</p>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => handleSelectConversation(conv.id)}
                className={`w-full text-left px-4 py-3 border-l-[3px] transition hover:bg-slate-700/30 ${
                  conv.id === selectedId
                    ? "border-l-orange-500 bg-slate-700/40"
                    : "border-l-transparent"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white truncate">
                        {conv.customerName}
                      </span>
                      <span
                        className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          statusBadgeClasses[conv.status]
                        }`}
                      >
                        {conv.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{conv.car}</p>
                    <p className="text-xs text-slate-500 mt-1 truncate">{conv.lastMessage}</p>
                  </div>
                  <span className="text-[10px] text-slate-500 whitespace-nowrap shrink-0 mt-0.5">
                    {conv.timestamp}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: Chat view ─────────────────────────────────── */}
      <div
        className={`${
          showChat && !showList ? "flex" : showChat && showList ? "hidden" : "hidden"
        } lg:flex flex-1 flex-col min-w-0 bg-slate-900`}
      >
        {selectedConversation ? (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-800/60 shrink-0">
              {/* Mobile back button */}
              <button
                type="button"
                onClick={handleBackToList}
                className="lg:hidden text-slate-400 hover:text-white transition p-1 -ml-1"
                aria-label="Back to conversations"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              {/* Avatar */}
              <div className="h-9 w-9 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400 text-sm font-bold shrink-0">
                {selectedConversation.customerName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white truncate">
                    {selectedConversation.customerName}
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      statusBadgeClasses[selectedConversation.status]
                    }`}
                  >
                    {selectedConversation.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate">{selectedConversation.car}</p>
              </div>

              {/* Contact icons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="text-slate-400 hover:text-white transition p-1.5 rounded-lg hover:bg-slate-700/50"
                  title={`Phone: ${selectedConversation.phone}`}
                  aria-label="Call customer"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="text-slate-400 hover:text-white transition p-1.5 rounded-lg hover:bg-slate-700/50"
                  title={`Email: ${selectedConversation.email}`}
                  aria-label="Email customer"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {isLoadingConv ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="flex items-center gap-2 animate-pulse">
                    <div className="h-2 w-2 rounded-full bg-orange-400" />
                    <div className="h-2 w-2 rounded-full bg-orange-400 animation-delay-150" />
                    <div className="h-2 w-2 rounded-full bg-orange-400 animation-delay-300" />
                  </div>
                  <p className="text-xs text-slate-500 mt-3">Loading conversation...</p>
                </div>
              ) : (
                selectedMessages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {sendError && <div className="mx-4 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{sendError}</div>}

            {/* Quick replies */}
            <div className="px-4 py-2 border-t border-slate-800 flex flex-wrap gap-2 shrink-0">
              {QUICK_REPLIES.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => handleQuickReply(reply)}
                  className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:border-orange-500/50 hover:text-orange-400 hover:bg-orange-500/5 transition"
                >
                  {reply}
                </button>
              ))}
            </div>

            {/* Input area */}
            <div className="px-4 py-3 border-t border-slate-700 bg-slate-800/40 shrink-0">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a response as the AI..."
                  className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={!messageInput.trim() || isSending}
                  className="shrink-0 flex items-center justify-center h-10 w-10 rounded-xl bg-orange-500 text-white hover:bg-orange-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send message"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-slate-600 text-right">
                Press Enter to send
              </p>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="text-6xl mb-4 opacity-30">💬</div>
            <p className="text-base font-medium text-slate-400">
              Select a conversation to view messages
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Choose a customer conversation from the left panel to get started
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Message bubble component ──────────────────────────────────────── */
function MessageBubble({ message }: { message: Message }) {
  if (message.sender === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-slate-800 px-3 py-1 text-[11px] text-slate-500 italic">
          {message.text}
        </span>
      </div>
    );
  }

  const isCustomer = message.sender === "customer";

  return (
    <div className={`flex ${isCustomer ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[75%] ${isCustomer ? "" : "flex flex-col items-end"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isCustomer
              ? "bg-slate-700 text-slate-200 rounded-tl-md"
              : "bg-orange-500/90 text-white rounded-tr-md"
          }`}
        >
          {message.text}
        </div>
        <span
          className={`mt-1 text-[10px] text-slate-600 ${isCustomer ? "text-left" : "text-right"}`}
        >
          {message.sender === "ai" && "AI • "}
          {message.timestamp}
        </span>
      </div>
    </div>
  );
}

/* ── Icon components ───────────────────────────────────────────────── */
function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}

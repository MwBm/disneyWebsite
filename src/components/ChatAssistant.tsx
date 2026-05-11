"use client";

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";

type Message = { role: "user" | "assistant"; content: string };

export const SUGGESTIONS = [
  "What are the least crowded days this week?",
  "Which rides should we hit first thing in the morning?",
  "Best strategy for visiting with young kids?",
  "Is Lightning Lane worth it?",
];

export type ChatAssistantHandle = { send: (text: string) => void };

const ChatAssistant = forwardRef<ChatAssistantHandle, Record<never, never>>(
  function ChatAssistant(_, ref) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    useEffect(() => {
      return () => { abortRef.current?.abort(); };
    }, []);

    const sendMessage = useCallback(async (text: string) => {
      if (!text.trim() || streaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMsg: Message = { role: "user", content: text.trim() };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setInput("");
      setStreaming(true);

      const assistantMsg: Message = { role: "assistant", content: "" };
      setMessages([...nextMessages, assistantMsg]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextMessages }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) throw new Error("Request failed");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: buffer };
            return updated;
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: "Sorry, something went wrong. Please try again.",
          };
          return updated;
        });
      } finally {
        setStreaming(false);
      }
    }, [messages, streaming]);

    useImperativeHandle(ref, () => ({ send: sendMessage }), [sendMessage]);

    async function send(e: React.FormEvent) {
      e.preventDefault();
      await sendMessage(input);
    }

    return (
      <div className="flex flex-col flex-1 min-h-[400px] bg-space-card border border-space-700 rounded-2xl shadow-sm overflow-hidden neon">
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 h-full min-h-[200px]">
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-orange-400"
                style={{ background: "rgba(240,192,96,0.07)", border: "1px solid rgba(240,192,96,0.18)" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p className="text-warm-700 text-sm text-center">
                Ask anything — try one of the suggestions above, or type your own question.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-orange-500 text-white rounded-br-sm"
                    : "bg-cream-200 text-warm-900 rounded-bl-sm"
                }`}
              >
                {msg.content}
                {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                  <span className="inline-block w-1 h-3.5 bg-warm-700 ml-0.5 animate-pulse" />
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={send} className="border-t border-space-700 p-4 flex gap-3 bg-cream-100">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about wait times, best times to visit, rides…"
            disabled={streaming}
            className="flex-1 bg-space-card border border-space-700 rounded-xl px-4 py-2.5 text-sm text-warm-900 placeholder-warm-500 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    );
  }
);

export default ChatAssistant;

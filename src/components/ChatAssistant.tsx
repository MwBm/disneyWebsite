"use client";

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import DisneyDatePicker from "./DisneyDatePicker";
import { parkDateKey } from "@/lib/park-time";

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
    const [visitDate, setVisitDate] = useState(() => parkDateKey(new Date()));
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
          body: JSON.stringify({ messages: nextMessages, date: visitDate }),
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
    }, [messages, streaming, visitDate]);

    useImperativeHandle(ref, () => ({ send: sendMessage }), [sendMessage]);

    async function send(e: React.FormEvent) {
      e.preventDefault();
      await sendMessage(input);
    }

    return (
      <div className="panel flex min-h-[400px] flex-1 flex-col overflow-hidden">
        <div className="border-b border-space-700 bg-cream-100 px-4 py-3">
          <DisneyDatePicker value={visitDate} onChange={setVisitDate} label="Plan for date" />
        </div>
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3">
              <p className="eyebrow">Planning help</p>
              <p className="max-w-sm text-center text-sm leading-6 text-warm-700">
                Ask anything — try one of the suggestions above, or type your own question.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-warm-900 text-space-900"
                    : "border border-space-700 bg-space-800 text-warm-900"
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

        <form onSubmit={send} className="flex gap-3 border-t border-space-700 bg-cream-100 p-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about wait times, best times to visit, rides…"
            disabled={streaming}
            className="flex-1 rounded-lg border border-space-700 bg-space-card px-4 py-2.5 text-sm text-warm-900 placeholder-warm-500 focus:outline-none focus:ring-2 focus:ring-warm-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="primary-action px-4 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    );
  }
);

export default ChatAssistant;

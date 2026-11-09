"use client";

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import DisneyDatePicker from "./DisneyDatePicker";
import ChatMarkdown from "./ChatMarkdown";
import { parkDateKey } from "@/lib/park-time";

type Message = { role: "user" | "assistant"; content: string };

export const SUGGESTIONS = [
  "Build me a low-wait morning plan",
  "Which three rides should I prioritize?",
  "Where can I save the most time?",
  "What should I leave until later?",
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
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 && (
            <div className="m-auto flex max-w-lg flex-col items-center rounded-xl border border-space-700/80 bg-space-800/60 px-6 py-8 text-center shadow-sm">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-sky-300/30 bg-sky-300/10 text-lg" aria-hidden="true">✦</div>
              <p className="eyebrow">Your park-planning copilot</p>
              <h2 className="mt-2 text-lg font-medium tracking-tight text-white">Start with the day you&apos;re visiting</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-warm-700">
                I&apos;ll turn that date&apos;s forecast into practical ride priorities, timing tips, and a realistic plan—not just a list of waits.
              </p>
              <p className="mt-4 text-xs text-warm-500">Choose a prompt above or ask about your group, must-do rides, or arrival time.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sky-300/30 bg-sky-300/10 text-xs text-sky-100" aria-label="Disney planner">
                  ✦
                </div>
              )}
              <div
                className={`max-w-[88%] rounded-xl px-4 py-3.5 text-sm shadow-sm sm:max-w-[80%] ${
                  msg.role === "user"
                    ? "bg-sky-200 text-space-900"
                    : "border border-space-700/90 bg-space-800/90 text-warm-900"
                }`}
              >
                {msg.role === "assistant" ? (
                  <>
                    <p className="mb-2 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-sky-200/80">Disney planner</p>
                    <ChatMarkdown content={msg.content} />
                  </>
                ) : (
                  <p className="whitespace-pre-wrap leading-6">{msg.content}</p>
                )}
                {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                  <span className="ml-1 inline-block h-3.5 w-1 animate-pulse bg-sky-200 align-middle" />
                )}
              </div>
              {msg.role === "user" && (
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-space-700 text-xs text-warm-700" aria-label="You">You</div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={send} className="flex gap-3 border-t border-space-700 bg-space-800/70 p-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for a plan, best next ride, or low-wait strategy…"
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

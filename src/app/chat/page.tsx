"use client";

import { useRef } from "react";
import ChatAssistant, { SUGGESTIONS, ChatAssistantHandle } from "@/components/ChatAssistant";
import PageHeader from "@/components/PageHeader";

const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

export default function ChatPage() {
  const chatRef = useRef<ChatAssistantHandle>(null);

  return (
    <div className="flex flex-col gap-4 flex-1">
      <PageHeader
        icon={<ChatIcon />}
        title="Chat"
        subtitle="Ask anything about Disneyland — live wait times, ride tips, and planning advice."
      />

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => chatRef.current?.send(s)}
            className="text-xs bg-space-card border border-space-700 text-warm-700 rounded-full px-3.5 py-2 hover:border-orange-500/50 hover:text-orange-400 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      <ChatAssistant ref={chatRef} />
    </div>
  );
}

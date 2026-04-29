import ChatAssistant from "@/components/ChatAssistant";

export default function ChatPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl border border-space-600 flex items-center justify-center text-orange-400 shrink-0"
          style={{ background: "rgba(59,130,246,0.08)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-warm-900 tracking-tight">Chat</h1>
          <p className="text-warm-700 text-sm mt-0.5">
            Ask anything about Disneyland — live wait times, ride tips, and planning advice.
          </p>
        </div>
      </div>
      <ChatAssistant />
    </div>
  );
}

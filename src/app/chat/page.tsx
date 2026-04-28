import ChatAssistant from "@/components/ChatAssistant";

export default function ChatPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-warm-900 tracking-tight">Chat</h1>
        <p className="text-warm-700 text-sm mt-1">
          Ask anything about Disneyland — live wait times, ride tips, and planning advice.
        </p>
      </div>
      <ChatAssistant />
    </div>
  );
}

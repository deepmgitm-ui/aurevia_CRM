"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Bot, LoaderCircle, MessageCircle, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export function AssistantChat({ role }: { role: "admin" | "manager" | "employee" }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: role === "employee"
        ? "Namaste! CRM ke features kahan milte hain, main usmein help kar sakta hoon."
        : "Namaste! CRM ke features, jaise lead assignment aur reports, kahan milte hain main bata sakta hoon.",
    },
  ]);
  const conversationEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || sending) return;

    setInput("");
    setMessages((current) => [...current, { role: "user", text: question }]);
    setSending(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          history: messages.slice(-8).map(({ role, text }) => ({ role, content: text })),
        }),
      });
      const payload: unknown = await response.json();
      const answer = payload && typeof payload === "object" && "answer" in payload && typeof payload.answer === "string"
        ? payload.answer
        : null;
      const error = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Assistant request failed. Please try again.";

      setMessages((current) => [
        ...current,
        { role: "assistant", text: response.ok && answer ? answer : error },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: "Could not reach the assistant. Check your connection and try again." },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {open && (
        <section
          aria-label="Aurevia CRM assistant"
          className="mb-3 flex h-[min(580px,calc(100dvh-7rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        >
          <header className="flex items-center justify-between bg-[#1e3a8a] px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Bot className="size-5" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold">Aurevia Assistant</h2>
                <p className="text-xs text-blue-100">
                  {role === "employee" ? "CRM feature guide" : "CRM feature guide"}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close assistant"
              className="text-white hover:bg-white/15 hover:text-white"
              onClick={() => setOpen(false)}
            >
              <X aria-hidden="true" />
            </Button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "ml-auto bg-[#1e3a8a] text-white"
                    : "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"
                }`}
              >
                {message.text}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Thinking…
              </div>
            )}
            <div ref={conversationEnd} />
          </div>

          <form onSubmit={sendMessage} className="space-y-2 border-t border-slate-200 bg-white p-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="CRM feature kahan milega?"
              aria-label="Message the CRM assistant"
              maxLength={1000}
              rows={2}
              disabled={sending}
              className="min-h-16 resize-none"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] leading-4 text-slate-500">
                Customer details mat bhejein. Sawal Cloudflare AI ko jayega; CRM records nahi.
              </p>
              <Button type="submit" size="icon" aria-label="Send message" disabled={sending || !input.trim()}>
                <Send aria-hidden="true" />
              </Button>
            </div>
          </form>
        </section>
      )}
      <Button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? "Close CRM assistant" : "Open CRM assistant"}
        aria-expanded={open}
        className="ml-auto flex size-12 rounded-full bg-[#1e3a8a] text-white shadow-lg hover:bg-blue-900"
      >
        {open ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
      </Button>
    </div>
  );
}

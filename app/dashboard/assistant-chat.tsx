"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const AssistantChatPanel = dynamic(
  () => import("./assistant-chat-panel").then((module) => module.AssistantChatPanel),
  { loading: () => null },
);

export function AssistantChat({ role }: { role: "admin" | "manager" | "employee" }) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) setHasOpened(true);
  }

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {hasOpened && <AssistantChatPanel open={open} role={role} onClose={() => setOpen(false)} />}
      <Button
        type="button"
        onClick={toggleOpen}
        aria-label={open ? "Close CRM assistant" : "Open CRM assistant"}
        aria-expanded={open}
        className="ml-auto flex size-12 rounded-full bg-[#1e3a8a] text-white shadow-lg hover:bg-blue-900"
      >
        {open ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
      </Button>
    </div>
  );
}

"use client";

import { useEffect } from "react";

export default function MarkThreadRead({ threadId, unread }: { threadId: string; unread: boolean }) {
  useEffect(() => {
    if (!unread) return;
    void fetch(`/api/emails/threads/${encodeURIComponent(threadId)}/read`, { method: "POST" });
  }, [threadId, unread]);

  return null;
}

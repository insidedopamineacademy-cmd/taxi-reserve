// src/components/Providers.tsx
"use client";

import { SessionProvider } from "next-auth/react";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import LocationBoundary from "@/components/security/LocationBoundary";
import type { Session } from "next-auth";

type Props = {
  children: React.ReactNode;
  assistantEnabled: boolean;
  assistantPreviewMode: boolean;
  session: Session | null;
};

export function Providers({ children, assistantEnabled, assistantPreviewMode, session }: Props) {
  const content = assistantEnabled
    ? <AssistantProvider previewMode={assistantPreviewMode}>{children}</AssistantProvider>
    : children;
  return <SessionProvider session={session} refetchOnWindowFocus={false}>
    {session?.id
      ? <LocationBoundary key={session.id} sessionId={session.id}>{content}</LocationBoundary>
      : content}
  </SessionProvider>;
}

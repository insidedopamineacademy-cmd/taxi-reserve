// src/components/Providers.tsx
"use client";

import { SessionProvider } from "next-auth/react";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";

type Props = {
  children: React.ReactNode;
  assistantEnabled: boolean;
  assistantPreviewMode: boolean;
};

export function Providers({ children, assistantEnabled, assistantPreviewMode }: Props) {
  const content = (
    <SessionProvider refetchOnWindowFocus={false}>
      {children}
    </SessionProvider>
  );

  if (!assistantEnabled) return content;

  return <AssistantProvider previewMode={assistantPreviewMode}>{content}</AssistantProvider>;
}

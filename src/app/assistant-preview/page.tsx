import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AssistantPreviewHarness } from "@/components/assistant/AssistantPreviewHarness";
import { isAssistantEnabled, isAssistantPreviewEnabled } from "@/lib/assistant/config";

export const metadata: Metadata = {
  title: "Assistant Fixture Preview",
  robots: { index: false, follow: false },
};

export default function AssistantPreviewPage() {
  if (!isAssistantEnabled() || !isAssistantPreviewEnabled()) notFound();
  return <AssistantPreviewHarness />;
}

// src/app/layout.tsx
import "./globals.css";
import "./mobile.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { getServerSession } from "next-auth";
import ServerNavbar from "@/components/ServerNavbar";
import { Providers } from "@/components/Providers";
import { authOptions } from "@/lib/auth";
import {
  isAssistantEmailAllowed,
  isAssistantEnabled,
  isAssistantPreviewEnabled,
} from "@/lib/assistant/config";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Taxi Reserve",
  description: "Taxi reservation and driver operations",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const assistantEnabled = isAssistantEnabled();
  const assistantPreviewMode = assistantEnabled && isAssistantPreviewEnabled();
  const session = assistantEnabled ? await getServerSession(authOptions) : null;
  let assistantAllowed = false;
  if (assistantEnabled) {
    try {
      assistantAllowed =
        Boolean(session?.user?.email) &&
        isAssistantEmailAllowed(session?.user?.email);
    } catch {
      // Invalid rollout configuration fails closed without destabilizing the rest
      // of the authenticated application shell.
      assistantAllowed = false;
    }
  }
  const assistantShellEnabled = assistantPreviewMode || assistantAllowed;

  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers
          assistantEnabled={assistantShellEnabled}
          assistantPreviewMode={assistantPreviewMode}
        >
          <ServerNavbar assistantEnabled={assistantShellEnabled} />
          <main className="min-h-screen">{children}</main>
        </Providers>
      </body>
    </html>
  );
}

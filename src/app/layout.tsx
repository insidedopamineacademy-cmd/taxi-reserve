// src/app/layout.tsx
import "./globals.css";
import "./mobile.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import ServerNavbar from "@/components/ServerNavbar";
import { Providers } from "@/components/Providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ReservationApp",
  description: "Taxi reservation app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <ServerNavbar />
          <main className="min-h-screen">{children}</main>
        </Providers>
      </body>
    </html>
  );
}

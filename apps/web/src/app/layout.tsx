import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Agent Trust Oracle: trust scores agents can't buy",
  description:
    "Payment-grounded trust scores for Solana agents. Wash trading and self-dealing stripped out, verifiable scores published onchain, readable by any program in one account load.",
  openGraph: {
    title: "Agent Trust Oracle",
    description:
      "Trust scores agents can't buy. Built from settled x402 and payment-channel flows on Solana.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#06060a" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans text-zinc-100 antialiased selection:bg-sol-purple/40">
        {children}
      </body>
    </html>
  );
}

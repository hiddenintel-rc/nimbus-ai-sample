import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import LDClientProvider from "@/components/LDClientProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nimbus — AI chat that scales with your plan",
  description:
    "Demo SaaS app for the LaunchDarkly SE technical exercise: tiered AI chat with feature flags, targeting, experimentation, and AI Configs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LDClientProvider>{children}</LDClientProvider>
      </body>
    </html>
  );
}

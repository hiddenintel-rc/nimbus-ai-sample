import type { Metadata } from "next";
import { Geist, Geist_Mono, Baloo_2 } from "next/font/google";
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

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["600"],
});

export const metadata: Metadata = {
  title: "Nimbus — AI chat that scales with your plan",
  description:
    "Nimbus is a demo project exploring tiered AI chat access, powered by LaunchDarkly for feature flags, targeting, and experimentation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${baloo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LDClientProvider>{children}</LDClientProvider>
      </body>
    </html>
  );
}

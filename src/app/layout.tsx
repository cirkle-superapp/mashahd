import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mashahd — مشاهِد | Watch, share and discover videos",
  description:
    "Mashahd (مشاهِد) — an AI-native video discovery app. Browse the home feed, watch videos, leave comments, subscribe to channels, get AI summaries, smart chapters and live translations. Brand mark & AI concepts adapted from CIRKLE (دواير).",
  keywords: [
    "video",
    "streaming",
    "mashahd",
 "مشاهِد",
    "cirkle",
    "AI video",
    "next.js",
    "typescript",
    "tailwind",
    "shadcn/ui",
  ],
  authors: [{ name: "Z.ai" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Mashahd — مشاهِد | Watch, share and discover videos",
    description: "An AI-native video discovery app. Brand & concepts adapted from CIRKLE.",
    siteName: "Mashahd",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
          <Sonner position="bottom-right" richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}

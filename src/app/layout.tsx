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
  title: "ZTube — Watch, share and discover videos",
  description:
    "A YouTube-style video sharing demo built with Next.js 16, TypeScript, Tailwind CSS 4 and shadcn/ui. Browse the home feed, watch videos, leave comments, subscribe to channels and more.",
  keywords: [
    "video",
    "streaming",
    "youtube",
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
    title: "ZTube — Watch, share and discover videos",
    description: "A YouTube-style video sharing demo.",
    siteName: "ZTube",
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

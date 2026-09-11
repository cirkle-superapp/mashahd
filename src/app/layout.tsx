import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, Tajawal } from "next/font/google";
import "./globals.css";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});
const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic", "latin"],
  display: "swap",
  weight: ["300", "400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Mashahd — مشاهِد | Video pillar of the super-app",
  description:
    "Mashahd (مشاهِد) — the AI-native video pillar of the super-app. Watch, discover, summarize, and translate videos. Brand & concepts adapted from CIRKLE (دواير).",
  keywords: [
    "video",
    "streaming",
    "mashahd",
    "مشاهِد",
    "cirkle",
    "super app",
    "AI video",
    "next.js",
    "typescript",
    "tailwind",
  ],
  authors: [{ name: "Z.ai" }],
  openGraph: {
    title: "Mashahd — مشاهِد | Video pillar of the super-app",
    description: "An AI-native video module. Brand & concepts adapted from CIRKLE.",
    siteName: "Mashahd",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FDFCF9" },
    { media: "(prefers-color-scheme: dark)", color: "#1A4A5A" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${fraunces.variable} ${tajawal.variable} antialiased bg-background text-foreground`}
      >
        {/* Prevent FOUC: apply saved theme before hydration.
            First-time visitors get light (Mashahd's default identity). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("mashahd-theme")||localStorage.getItem("theme");if(t===null){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}if(t==="dark"){document.documentElement.classList.add("dark");}}catch(e){}})();`,
          }}
        />
        <Providers>
          {children}
          <Sonner position="bottom-right" richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}

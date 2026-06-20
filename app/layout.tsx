import type { Metadata } from "next";
import { Prompt, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PublicChrome } from "@/components/PublicChrome";

export const dynamic = 'force-dynamic';

const prompt = Prompt({
  variable: "--font-prompt",
  subsets: ["latin", "thai"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chonburi Futsal Youth League 2026",
  description: "ลีกฟุตซอลเยาวชนจังหวัดชลบุรี 2026",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${prompt.variable} ${geistMono.variable} h-full antialiased scroll-smooth`}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <PublicChrome>{children}</PublicChrome>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

export const dynamic = 'force-dynamic';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased scroll-smooth`}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body className="min-h-screen flex flex-col bg-gray-50">
        <header className="bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-lg">
          <nav className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">⚽ CFYL</h1>
                <p className="text-blue-100 text-sm">Chonburi Futsal Youth League</p>
              </div>
              <div className="flex gap-4">
                <a href="/" className="hover:text-blue-200 transition">Home</a>
                <a href="/fixtures" className="hover:text-blue-200 transition">Fixtures</a>
                <a href="/standings" className="hover:text-blue-200 transition">Standings</a>
                <a href="/top-scorers" className="hover:text-blue-200 transition">Top Scorers</a>
                <a href="/discipline" className="hover:text-blue-200 transition">Discipline</a>
              </div>
            </div>
          </nav>
        </header>

        <main className="flex-1 container mx-auto px-4 py-8">
          {children}
        </main>

        <footer className="bg-gray-800 text-gray-200 py-6 mt-12">
          <div className="container mx-auto px-4 text-center">
            <p>© 2026 Chonburi Futsal Youth League</p>
          </div>
        </footer>
      </body>
    </html>
  );
}

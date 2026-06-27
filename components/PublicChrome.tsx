'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  resolveCurrentSeasonSlug,
  buildStandingsPath,
  buildFixturesPath,
  buildTopScorersPath,
  buildDisciplinePath,
} from '@/lib/public-slugs';

const NAV_LINKS = [
  { href: '/', label: 'หน้าหลัก' },
  { href: '/fixtures', label: 'โปรแกรมแข่งขัน' },
  { href: '/standings', label: 'ตารางคะแนน' },
  { href: '/top-scorers', label: 'ดาวซัลโว' },
  { href: '/discipline', label: 'ระเบียบวินัย' },
  { href: '/tournaments', label: 'ทัวร์นาเมนต์' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function PublicChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [cleanHrefs, setCleanHrefs] = useState<Record<string, string>>({});

  const onAdmin = pathname.startsWith('/admin');

  // Point public menu items at the current-season clean URLs (fallback base paths)
  useEffect(() => {
    if (onAdmin) return;
    let active = true;
    resolveCurrentSeasonSlug().then((r) => {
      if (!active || !r) return;
      const { seasonSeg: y, ageGroupCode: c } = r;
      setCleanHrefs({
        '/standings': buildStandingsPath(y, c),
        '/fixtures': buildFixturesPath(y, c),
        '/top-scorers': buildTopScorersPath(y, c),
        '/discipline': buildDisciplinePath(y, c),
      });
    });
    return () => {
      active = false;
    };
  }, [onAdmin]);

  const hrefFor = (href: string) => cleanHrefs[href] || href;

  // Admin owns its own full-screen layout — render children through untouched.
  if (onAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      <header className="bg-blue-900 text-white shadow-sm sticky top-0 z-40">
        <nav className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5" onClick={() => setMenuOpen(false)}>
              <span className="text-xl">⚽</span>
              <span className="leading-tight">
                <span className="block font-bold text-base">CFYL</span>
                <span className="block text-[11px] text-blue-200 -mt-0.5">
                  Chonburi Futsal Youth League
                </span>
              </span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={hrefFor(link.href)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition ${
                    isActive(pathname, link.href)
                      ? 'bg-white/15 text-white'
                      : 'text-blue-100 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/admin"
                className="ml-2 px-3.5 py-2 rounded-md text-sm font-semibold text-white border border-white/40 hover:bg-white/10 transition"
              >
                Admin
              </Link>
            </div>

            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="เมนู"
              aria-expanded={menuOpen}
              className="md:hidden inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-lg hover:bg-white/10 transition"
            >
              <span className="text-2xl leading-none">{menuOpen ? '✕' : '☰'}</span>
            </button>
          </div>
        </nav>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="md:hidden border-t border-white/10 bg-blue-900">
            <div className="container mx-auto px-4 py-2 space-y-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={hrefFor(link.href)}
                  onClick={() => setMenuOpen(false)}
                  className={`block px-3 py-3 rounded-lg text-base font-medium transition ${
                    isActive(pathname, link.href)
                      ? 'bg-white/15 text-white'
                      : 'text-blue-100 hover:bg-white/10'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <div className="pt-1 mt-1 border-t border-white/10">
                <Link
                  href="/admin"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-3 rounded-lg text-base font-semibold text-white"
                >
                  🔒 Admin
                </Link>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 sm:py-8">{children}</main>

      <footer className="bg-slate-900 text-slate-300 py-6 mt-10">
        <div className="container mx-auto px-4 text-center text-sm">
          <p className="font-semibold text-slate-200">Chonburi Futsal Youth League</p>
          <p className="text-slate-400 mt-1">© 2026 CFYL · ลีกฟุตซอลเยาวชนจังหวัดชลบุรี</p>
        </div>
      </footer>
    </>
  );
}

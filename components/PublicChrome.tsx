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
import { buildPublicTournamentNavLinks } from '@/lib/tournament/ui-retirement';

interface PublicNavLink {
  href: string;
  label: string;
  badge?: string;
}

const CORE_NAV_LINKS: PublicNavLink[] = [
  { href: '/', label: 'หน้าหลัก' },
  { href: '/fixtures', label: 'โปรแกรมแข่งขัน' },
  { href: '/standings', label: 'ตารางคะแนน' },
  { href: '/top-scorers', label: 'ดาวซัลโว' },
  { href: '/discipline', label: 'ระเบียบวินัย' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavBadge({ badge }: { badge?: string }) {
  if (!badge) return null;

  return (
    <span className="rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
      {badge}
    </span>
  );
}

export function PublicChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [cleanHrefs, setCleanHrefs] = useState<Record<string, string>>({});

  const onAdmin = pathname.startsWith('/admin');
  const navLinks = [...CORE_NAV_LINKS, ...buildPublicTournamentNavLinks()];

  useEffect(() => {
    if (onAdmin) return;
    let active = true;

    resolveCurrentSeasonSlug().then((resolved) => {
      if (!active || !resolved) return;

      const { seasonSeg, ageGroupCode } = resolved;
      setCleanHrefs({
        '/standings': buildStandingsPath(seasonSeg, ageGroupCode),
        '/fixtures': buildFixturesPath(seasonSeg, ageGroupCode),
        '/top-scorers': buildTopScorersPath(seasonSeg, ageGroupCode),
        '/discipline': buildDisciplinePath(seasonSeg, ageGroupCode),
      });
    });

    return () => {
      active = false;
    };
  }, [onAdmin]);

  const hrefFor = (href: string) => cleanHrefs[href] || href;

  if (onAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-blue-900 text-white shadow-sm">
        <nav className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5" onClick={() => setMenuOpen(false)}>
              <span className="text-xl">⚽</span>
              <span className="leading-tight">
                <span className="block text-base font-bold">CFYL</span>
                <span className="mt-[-2px] block text-[11px] text-blue-200">
                  Chonburi Futsal Youth League
                </span>
              </span>
            </Link>

            <div className="hidden items-center gap-1 md:flex">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={hrefFor(link.href)}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                    isActive(pathname, link.href)
                      ? 'bg-white/15 text-white'
                      : 'text-blue-100 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span>{link.label}</span>
                  <NavBadge badge={link.badge} />
                </Link>
              ))}
              <Link
                href="/admin"
                className="ml-2 rounded-md border border-white/40 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Admin
              </Link>
            </div>

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="เมนู"
              aria-expanded={menuOpen}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition hover:bg-white/10 md:hidden"
            >
              <span className="text-2xl leading-none">{menuOpen ? '✕' : '☰'}</span>
            </button>
          </div>
        </nav>

        {menuOpen && (
          <div className="border-t border-white/10 bg-blue-900 md:hidden">
            <div className="container mx-auto space-y-1 px-4 py-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={hrefFor(link.href)}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center justify-between rounded-lg px-3 py-3 text-base font-medium transition ${
                    isActive(pathname, link.href)
                      ? 'bg-white/15 text-white'
                      : 'text-blue-100 hover:bg-white/10'
                  }`}
                >
                  <span>{link.label}</span>
                  <NavBadge badge={link.badge} />
                </Link>
              ))}
              <div className="mt-1 border-t border-white/10 pt-1">
                <Link
                  href="/admin"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-3 text-base font-semibold text-white"
                >
                  <span>🔒</span>
                  <span>Admin</span>
                </Link>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="container mx-auto flex-1 px-4 py-6 sm:py-8">{children}</main>

      <footer className="mt-10 bg-slate-900 py-6 text-slate-300">
        <div className="container mx-auto px-4 text-center text-sm">
          <p className="font-semibold text-slate-200">Chonburi Futsal Youth League</p>
          <p className="mt-1 text-slate-400">© 2026 CFYL · ลีกฟุตซอลเยาวชนจังหวัดชลบุรี</p>
        </div>
      </footer>
    </>
  );
}

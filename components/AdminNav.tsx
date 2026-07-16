'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

interface AdminNavProps {
  email: string;
  fullName?: string | null;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [{ href: '/admin/dashboard', label: 'Dashboard', icon: '📊' }],
  },
  {
    title: 'Matchday',
    items: [
      { href: '/admin/matches', label: 'Matches', icon: '🎮' },
      { href: '/admin/matches/manage', label: 'Match Management', icon: '⚙️' },
      { href: '/admin/goals', label: 'Goals', icon: '⚽' },
      { href: '/admin/cards', label: 'Cards', icon: '🟨' },
      { href: '/admin/suspensions', label: 'Suspensions', icon: '🚨' },
      { href: '/admin/staff-discipline', label: 'Staff Discipline', icon: '👔' },
      { href: '/admin/match-bulk-import', label: 'Bulk Import', icon: '📥' },
    ],
  },
  {
    title: 'People & Teams',
    items: [
      { href: '/admin/teams', label: 'Teams', icon: '👥' },
      { href: '/admin/teams/logos', label: 'Team Logos', icon: '🖼️' },
      { href: '/admin/players', label: 'Players', icon: '👤' },
    ],
  },
  {
    title: 'Tournament V2',
    items: [
      { href: '/admin/tournament', label: 'Tournament Center', icon: '🏆' },
      { href: '/admin/tournament/setup', label: 'Setup & Venues', icon: '⚙️' },
      { href: '/admin/tournament/meeting-draw', label: 'Meeting Draw', icon: '🎲' },
      { href: '/admin/tournament/schedule/import', label: 'Import Schedule', icon: '📅' },
    ],
  },
  {
    title: 'Publish & Tools',
    items: [
      { href: '/admin/data-quality', label: 'Data Quality', icon: '🧪' },
      { href: '/admin/exports', label: 'Exports', icon: '📋' },
      { href: '/admin/backup', label: 'Backup', icon: '💾' },
      { href: '/admin/audit-logs', label: 'Audit Logs', icon: '🧾' },
    ],
  },
  {
    title: 'System',
    items: [{ href: '/admin/settings', label: 'Settings', icon: '⚙️' }],
  },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === '/admin/dashboard' || href === '/admin/tournament') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({ email, fullName }: AdminNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{
    version?: string;
    shortSha?: string | null;
    commitRef?: string | null;
    vercelEnv?: string | null;
  } | null>(null);

  useEffect(() => {
    let mounted = true;

    fetch('/api/admin/version', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && data) setVersionInfo(data);
      })
      .catch(() => {
        if (mounted) setVersionInfo({ version: 'unknown' });
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const supabase = getSupabaseBrowser();
      await supabase.auth.signOut();
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_remember_me');
      sessionStorage.removeItem('admin_active_session');
      router.push('/admin/login');
    } catch (error) {
      console.error('[ADMIN_NAV] Logout error:', error);
      setIsLoggingOut(false);
    }
  };

  return (
    <aside className="w-64 h-screen shrink-0 bg-gray-900 text-white shadow-lg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-4 border-b border-gray-800">
        <h1 className="text-lg font-bold">⚽ CFYL Admin</h1>
        <p className="text-xs text-gray-500">Control Panel</p>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="px-3 mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                {group.title}
              </p>

              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = isActivePath(pathname, item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                        active
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }`}
                    >
                      <span className="w-5 text-center">{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* User Section */}
      <div className="shrink-0 px-3 py-3 border-t border-gray-800">
        <div className="mb-3 px-3 py-2 bg-gray-800 rounded-lg">
          <p className="text-[11px] text-gray-400">Logged in as</p>
          <p className="text-sm font-semibold text-white truncate">{fullName || email}</p>
          <p className="text-[11px] text-gray-500 truncate">{email}</p>
          {versionInfo && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="inline-flex rounded bg-gray-700 px-1.5 py-0.5 text-[10px] font-mono text-gray-200">
                v{versionInfo.shortSha || versionInfo.version || '...'}
              </span>
              {versionInfo.commitRef && (
                <span className="inline-flex rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">
                  {versionInfo.commitRef}
                </span>
              )}
              {versionInfo.vercelEnv && (
                <span className="inline-flex rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">
                  {versionInfo.vercelEnv}
                </span>
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 rounded-lg text-sm font-semibold transition text-white"
        >
          {isLoggingOut ? 'Logging out...' : '🚪 Logout'}
        </button>
      </div>
    </aside>
  );
}

export function AdminNavContent({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-w-0 h-screen flex flex-col overflow-hidden bg-gray-100">
      {/* Top Bar */}
      <div className="shrink-0 bg-white shadow-sm border-b border-gray-200">
        <div className="px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">Admin Panel</h2>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            เปิดหน้าเว็บ Public →
          </a>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

interface AdminNavProps {
  email: string;
  fullName?: string | null;
}

export function AdminNav({ email, fullName }: AdminNavProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

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
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white shadow-lg flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold">⚽ CFYL Admin</h1>
          <p className="text-sm text-gray-400">Control Panel</p>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-4">
          <div className="space-y-2">
            <Link
              href="/admin/dashboard"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition font-semibold text-blue-400 hover:text-blue-300"
            >
              📊 Dashboard
            </Link>

            <Link
              href="/admin/matches"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              🎮 Matches
            </Link>

            <Link
              href="/admin/matches/manage"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              ⚙️ Match Management
            </Link>

            <Link
              href="/admin/goals"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              ⚽ Goals
            </Link>

            <Link
              href="/admin/cards"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              🟨 Cards
            </Link>

            <Link
              href="/admin/players"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              👤 Players
            </Link>

            <Link
              href="/admin/suspensions"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              🚨 Suspensions
            </Link>

            <Link
              href="/admin/teams"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              👥 Teams
            </Link>

            <Link
              href="/admin/seasons"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              🗓️ Seasons
            </Link>

            <Link
              href="/admin/tournament-groups"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              🏆 Tournaments
            </Link>

            <Link
              href="/admin/tournament-fixtures"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              📅 Tournament Fixtures
            </Link>

            <Link
              href="/admin/tournament-bracket"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              🏐 Tournament Bracket
            </Link>

            <Link
              href="/admin/exports"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              📋 Exports
            </Link>

            <Link
              href="/admin/backup"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              💾 Backup
            </Link>

            <Link
              href="/admin/audit-logs"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              🧾 Audit Logs
            </Link>

            <Link
              href="/admin/settings"
              className="block px-4 py-3 rounded-lg hover:bg-gray-800 transition hover:text-white"
            >
              ⚙️ Settings
            </Link>
          </div>
        </nav>

        {/* User Section */}
        <div className="p-4 border-t border-gray-800">
          <div className="mb-4 p-3 bg-gray-800 rounded-lg">
            <p className="text-sm text-gray-400">Logged in as</p>
            <p className="font-semibold text-white">{fullName || email}</p>
            <p className="text-xs text-gray-500">{email}</p>
          </div>

          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 rounded-lg font-semibold transition text-white"
          >
            {isLoggingOut ? 'Logging out...' : '🚪 Logout'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminNavContent({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="bg-white shadow">
        <div className="px-6 py-4">
          <h2 className="text-2xl font-bold text-gray-800">Admin Panel</h2>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

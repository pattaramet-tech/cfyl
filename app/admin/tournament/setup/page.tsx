'use client';

import { useEffect } from 'react';

export default function TournamentSetupPage() {
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        if (!token) {
          window.location.href = '/admin/login';
          return;
        }

        const res = await fetch('/api/tournament/admin/tournaments', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 403) {
          alert('ไม่มีสิทธิ์เข้าถึงการตั้งค่า Tournament');
          window.location.href = '/admin';
        } else if (!res.ok) {
          console.error('Auth check failed:', res.status);
        }
      } catch (err) {
        console.error('[TOURNAMENT_SETUP] Auth check error:', err);
      }
    };

    checkAuth();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-3xl font-bold text-gray-900">Tournament Setup</h1>
        <p className="mt-2 text-gray-600">Phase 2 Admin — Tournaments, Categories, Venues, Courts, Mappings</p>

        <div className="mt-8 rounded-lg bg-white p-6 shadow">
          <p className="text-gray-700">
            This is a Phase 2 placeholder. Full UI implementation follows the pattern of{' '}
            <code className="rounded bg-gray-100 px-2 py-1 font-mono text-sm">app/admin/seasons/page.tsx</code>.
          </p>

          <div className="mt-6 space-y-2">
            <p className="font-semibold text-gray-900">Endpoints (ready):</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
              <li>/api/tournament/admin/tournaments</li>
              <li>/api/tournament/admin/categories</li>
              <li>/api/tournament/admin/venues</li>
              <li>/api/tournament/admin/courts</li>
              <li>/api/tournament/admin/category-venues</li>
            </ul>
          </div>

          <div className="mt-6 space-y-2">
            <p className="font-semibold text-gray-900">Bootstrap:</p>
            <code className="block rounded bg-gray-100 p-3 font-mono text-xs">
              npm run bootstrap:tournament-super-admin
            </code>
          </div>

          <div className="mt-6 space-y-2">
            <p className="font-semibold text-gray-900">Seed:</p>
            <code className="block rounded bg-gray-100 p-3 font-mono text-xs">
              npm run seed:tournament-phase2 -- --tournament-slug=cfyl-2025 --tournament-name=&quot;CFYL 2025&quot;
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

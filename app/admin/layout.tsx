'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AdminNav, AdminNavContent } from '@/components/AdminNav';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import type { AdminProfile } from '@/lib/admin-auth';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const [adminProfile, setAdminProfile] = useState<Partial<AdminProfile> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLoginPage = pathname === '/admin/login';

  // Keep localStorage.admin_token in sync whenever the SDK silently refreshes the session
  useEffect(() => {
    if (isLoginPage) return;
    const supabase = getSupabaseBrowser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) {
        localStorage.setItem('admin_token', session.access_token);
        console.log('[ADMIN_LAYOUT] SDK refreshed token — synced to localStorage');
      }
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_remember_me');
        sessionStorage.removeItem('admin_active_session');
      }
    });
    return () => subscription.unsubscribe();
  }, [isLoginPage]);

  useEffect(() => {
    const checkAuth = async () => {
      if (isLoginPage) {
        setIsLoading(false);
        return;
      }

      try {
        const supabase = getSupabaseBrowser();

        // Get current session — SDK auto-refreshes access_token if expired
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !session) {
          console.warn('[ADMIN_LAYOUT] No session — redirecting to login');
          router.replace('/admin/login');
          return;
        }

        // Enforce "Remember me" policy
        const isPersistent = localStorage.getItem('admin_remember_me') === 'true';
        const hasActiveSession = !!sessionStorage.getItem('admin_active_session');

        if (!isPersistent && !hasActiveSession) {
          // User chose "no remember me" and the browser/tab was restarted → sign out
          console.warn('[ADMIN_LAYOUT] No-persist session expired (browser restarted) — signing out');
          await supabase.auth.signOut();
          localStorage.removeItem('admin_token');
          localStorage.removeItem('admin_remember_me');
          router.replace('/admin/login');
          return;
        }

        // Sync fresh access_token so every admin page's localStorage.getItem('admin_token') stays valid
        const freshToken = session.access_token;
        localStorage.setItem('admin_token', freshToken);

        // Verify admin profile
        const response = await fetch('/api/admin/auth/me', {
          headers: { Authorization: `Bearer ${freshToken}` },
        });

        if (!response.ok) {
          console.warn('[ADMIN_LAYOUT] /api/admin/auth/me rejected — signing out');
          await supabase.auth.signOut();
          localStorage.removeItem('admin_token');
          localStorage.removeItem('admin_remember_me');
          sessionStorage.removeItem('admin_active_session');
          router.replace('/admin/login');
          return;
        }

        const data = await response.json();
        if (data.authenticated) {
          setAdminProfile(data.user);
        } else {
          await supabase.auth.signOut();
          localStorage.removeItem('admin_token');
          localStorage.removeItem('admin_remember_me');
          sessionStorage.removeItem('admin_active_session');
          router.replace('/admin/login');
        }
      } catch (err) {
        console.error('[ADMIN_LAYOUT] Auth check error:', err);
        setError('Authentication failed');
        router.replace('/admin/login');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [router, isLoginPage]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          <p className="mt-4 text-gray-600">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (error || !adminProfile) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 font-semibold">{error || 'Authentication error'}</p>
          <a href="/admin/login" className="mt-4 inline-block text-blue-600 hover:underline">
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <AdminNav
        email={adminProfile.email || ''}
        fullName={adminProfile.full_name}
      />
      <AdminNavContent>
        {children}
      </AdminNavContent>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // If a valid persistent session exists, skip login
  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const supabase = getSupabaseBrowser();
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const isPersistent = localStorage.getItem('admin_remember_me') === 'true';
          const hasActiveSession = !!sessionStorage.getItem('admin_active_session');
          if (isPersistent || hasActiveSession) {
            router.replace('/admin/dashboard');
            return;
          }
        }
      } catch {
        // ignore — just show the login form
      } finally {
        setIsCheckingSession(false);
      }
    };
    checkExistingSession();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const supabase = getSupabaseBrowser();
      console.log('[LOGIN_PAGE] Signing in client-side for:', email);

      // Sign in directly with Supabase SDK — session (access + refresh tokens) stored by SDK
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError || !data.session) {
        setError(signInError?.message || 'Invalid email or password');
        return;
      }

      const accessToken = data.session.access_token;
      console.log('[LOGIN_PAGE] Supabase sign-in OK, verifying admin profile...');

      // Verify admin profile exists and is active
      const meRes = await fetch('/api/admin/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!meRes.ok) {
        // Not an admin — sign out immediately and show error
        await supabase.auth.signOut();
        const errData = await meRes.json().catch(() => ({}));
        setError(errData.error || 'Not authorised as admin');
        return;
      }

      console.log('[LOGIN_PAGE] Admin profile verified, storing session flags...');

      // Sync access_token to localStorage for all admin pages that read it
      localStorage.setItem('admin_token', accessToken);
      localStorage.setItem('admin_remember_me', rememberMe ? 'true' : 'false');

      if (!rememberMe) {
        // No-persist mode: store flag in sessionStorage; it disappears when browser/tab is closed
        sessionStorage.setItem('admin_active_session', '1');
      } else {
        sessionStorage.removeItem('admin_active_session');
      }

      console.log('[LOGIN_PAGE] Login complete, redirecting to dashboard...');
      router.replace('/admin/dashboard');
    } catch (err) {
      console.error('[LOGIN_PAGE] Login error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 to-blue-100 py-12 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">⚽ CFYL Admin</h1>
            <p className="text-gray-600">Chonburi Futsal Youth League</p>
            <p className="text-sm text-gray-500 mt-1">Admin Control Panel</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                required
                disabled={isLoading}
              />
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-3 py-1">
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={isLoading}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <label htmlFor="rememberMe" className="text-sm text-gray-700 cursor-pointer select-none">
                จดจำการเข้าสู่ระบบ <span className="text-gray-400">(Remember me)</span>
              </label>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">❌ {error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold rounded-lg transition mt-6"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-center text-sm text-gray-600">
              Back to{' '}
              <Link href="/" className="text-blue-600 hover:underline font-semibold">
                Public Website
              </Link>
            </p>
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-700">
              <strong>Note:</strong> Use your Supabase Auth credentials to login.
            </p>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-600">
          <p>🔒 This admin panel is secure and password-protected.</p>
        </div>
      </div>
    </div>
  );
}

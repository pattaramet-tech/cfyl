'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAlreadyLoggedIn, setIsAlreadyLoggedIn] = useState(false);

  // Check if already logged in
  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      setIsAlreadyLoggedIn(true);
      router.push('/admin/dashboard');
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      console.log('[LOGIN_PAGE] Submitting login for:', email);
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      console.log('[LOGIN_PAGE] Response status:', response.status);
      const data = await response.json();
      console.log('[LOGIN_PAGE] Response data:', {
        success: data.success,
        error: data.error,
        hasToken: !!data.token,
      });

      if (!response.ok) {
        const errorMsg = data.error || 'Login failed';
        console.error('[LOGIN_PAGE] Login error:', errorMsg);
        setError(errorMsg);
        return;
      }

      if (data.success && data.token) {
        console.log('[LOGIN_PAGE] Login successful, storing token...');
        // Store token
        localStorage.setItem('admin_token', data.token);
        console.log('[LOGIN_PAGE] Token stored, redirecting to dashboard...');

        // Redirect to dashboard
        router.push('/admin/dashboard');
      } else {
        console.error('[LOGIN_PAGE] Login response invalid:', data);
        setError('Login failed - invalid response');
      }
    } catch (error) {
      console.error('[LOGIN_PAGE] Login error:', error);
      const errorMsg = error instanceof Error ? error.message : 'An error occurred';
      setError(`Error: ${errorMsg}. Please try again.`);
    } finally {
      setIsLoading(false);
    }
  };

  if (isAlreadyLoggedIn) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 py-12 px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-lg shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">⚽ CFYL Admin</h1>
            <p className="text-gray-600">Chonburi Futsal Youth League</p>
            <p className="text-sm text-gray-500 mt-1">Admin Control Panel</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Input */}
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

            {/* Password Input */}
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

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">❌ {error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-bold rounded-lg transition mt-6"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-center text-sm text-gray-600">
              Back to{' '}
              <Link href="/" className="text-blue-600 hover:underline font-semibold">
                Public Website
              </Link>
            </p>
          </div>

          {/* Test Credentials Notice */}
          <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-700">
              <strong>Note:</strong> Use your Supabase Auth credentials to login.
            </p>
          </div>
        </div>

        {/* Security Notice */}
        <div className="mt-6 text-center text-xs text-gray-600">
          <p>🔒 This admin panel is secure and password-protected.</p>
        </div>
      </div>
    </div>
  );
}

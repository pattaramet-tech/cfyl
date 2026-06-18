'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav, AdminNavContent } from '@/components/AdminNav';
import type { AdminProfile } from '@/lib/admin-auth';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [adminProfile, setAdminProfile] = useState<Partial<AdminProfile> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('admin_token');

        if (!token) {
          router.push('/admin/login');
          return;
        }

        // Verify token and get profile
        const response = await fetch('/api/admin/auth/me', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          localStorage.removeItem('admin_token');
          router.push('/admin/login');
          return;
        }

        const data = await response.json();
        if (data.authenticated) {
          setAdminProfile(data.user);
        } else {
          localStorage.removeItem('admin_token');
          router.push('/admin/login');
        }
      } catch (error) {
        console.error('Auth check error:', error);
        setError('Authentication failed');
        localStorage.removeItem('admin_token');
        router.push('/admin/login');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
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
    <div className="flex h-screen bg-gray-100">
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

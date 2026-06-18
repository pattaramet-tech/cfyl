'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('admin_token');

    if (token) {
      // Already authenticated - redirect to dashboard
      router.push('/admin/dashboard');
    } else {
      // Not authenticated - redirect to login
      router.push('/admin/login');
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      <p className="ml-3 text-gray-600">Redirecting...</p>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buildLegacyAdminRollbackLinks } from '@/lib/tournament/ui-retirement';

interface TournamentSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

interface WorkflowCard {
  href: string;
  icon: string;
  title: string;
  description: string;
  badge: string;
  external?: boolean;
}

function authHeader(): Record<string, string> {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('admin_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const WORKFLOWS: WorkflowCard[] = [
  {
    href: '/admin/tournament/setup',
    icon: '⚙️',
    title: 'ตั้งค่ารายการและสนาม',
    description: 'Tournament, Category, Venue, Court และการจับคู่สนามหลัก',
    badge: 'Foundation',
  },
  {
    href: '/admin/tournament/meeting-draw',
    icon: '🎲',
    title: 'ประชุมและจับฉลากแบ่งสาย',
    description: 'กำหนดทีมลง Group Slot และแสดงผลบน Projector แบบเรียลไทม์',
    badge: 'พร้อมใช้งาน',
  },
  {
    href: '/admin/tournament/schedule/import',
    icon: '📥',
    title: 'Import ตารางแข่งขัน',
    description: 'นำเข้า XLSX/CSV พร้อม Preview, Validation, Diff และบันทึกแบบ Idempotent',
    badge: 'V2',
  },
  {
    href: '/tournament/schedule',
    icon: '📅',
    title: 'ตารางแข่งขัน Public',
    description: 'ตรวจข้อมูลที่นำเข้าและชื่อทีมที่ resolve จากผลจับฉลาก',
    badge: 'Public',
    external: true,
  },
];

export default function TournamentV2DashboardPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const rollbackLinks = buildLegacyAdminRollbackLinks();

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      window.location.href = '/admin/login';
      return;
    }

    fetch('/api/tournament/admin/tournaments', {
      headers: authHeader(),
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || 'โหลด Tournament V2 ไม่สำเร็จ');
        }
        return response.json();
      })
      .then((payload) => setTournaments((payload.data || []) as TournamentSummary[]))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'โหลด Tournament V2 ไม่สำเร็จ');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-blue-800 to-slate-900 p-7 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-bold tracking-wide ring-1 ring-white/25">
              CFYL TOURNAMENT V2
            </span>
            <h1 className="mt-4 text-3xl font-bold sm:text-4xl">ศูนย์จัดการ Tournament</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100 sm:text-base">
              ระบบใหม่แยกจาก League Database รองรับ Group Slot, Placeholder, 4 สนาม และ
              Import ตารางแข่งขันก่อนทราบทีมจริง
            </p>
          </div>
          <a
            href="/tournament/meeting-draw"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-blue-800 shadow-sm hover:bg-blue-50"
          >
            เปิด Projector จับฉลาก
          </a>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">ขั้นตอนการทำงาน</h2>
            <p className="mt-1 text-sm text-slate-500">
              Tournament V2 เป็นเส้นทางหลัก ส่วนเมนู Tournament V1 ถูกซ่อนจาก navigation ปกติ
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {WORKFLOWS.map((workflow) => {
            const card = (
              <div className="h-full rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-blue-300">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-3xl" aria-hidden="true">
                    {workflow.icon}
                  </span>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                    {workflow.badge}
                  </span>
                </div>
                <h3 className="mt-4 font-bold text-slate-900">{workflow.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{workflow.description}</p>
                <span className="mt-4 inline-flex text-sm font-semibold text-blue-700">
                  เปิดใช้งาน →
                </span>
              </div>
            );

            return workflow.external ? (
              <a key={workflow.href} href={workflow.href} target="_blank" rel="noopener noreferrer">
                {card}
              </a>
            ) : (
              <Link key={workflow.href} href={workflow.href}>
                {card}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">รายการใน Tournament V2</h2>
            <p className="mt-1 text-sm text-slate-500">
              ข้อมูลจาก Tournament Supabase Project แยกต่างหาก
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
            {loading ? 'กำลังโหลด...' : `${tournaments.length} รายการ`}
          </span>
        </div>

        {!loading && tournaments.length === 0 ? (
          <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
            ยังไม่มี Tournament V2 กรุณาเริ่มจากเมนูตั้งค่ารายการและสนาม
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">รายการ</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">ช่วงแข่งขัน</th>
                  <th className="px-4 py-3">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tournaments.map((tournament) => (
                  <tr key={tournament.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{tournament.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{tournament.slug}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {tournament.start_date || '—'} ถึง {tournament.end_date || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800">
                        {tournament.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
        <p>
          <strong>Legacy rollback:</strong> หน้าและ API ของ Tournament V1 ยังถูกเก็บไว้ใน
          repository เพื่อรองรับการตรวจสอบและย้อนกลับชั่วคราว แต่ถูกซ่อนจาก navigation ปกติแล้ว
        </p>
        {rollbackLinks.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {rollbackLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold text-amber-900 hover:bg-amber-100"
              >
                <span>{link.label}</span>
                {link.badge ? (
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
                    {link.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-amber-800">
            ลิงก์ rollback แบบแสดงผลถูกปิดไว้ตามค่าเริ่มต้น แต่ direct URL ของ Tournament V1
            ยังใช้งานได้หากจำเป็น
          </p>
        )}
      </aside>
    </div>
  );
}

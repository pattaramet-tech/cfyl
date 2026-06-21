'use client';

import { useCallback, useEffect, useState } from 'react';

interface AuditLog {
  id: string;
  admin_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  old_data: unknown;
  new_data: unknown;
  created_at: string;
}

const ENTITY_TYPES = ['', 'match', 'goal', 'card', 'suspension'];
const ACTIONS = [
  '',
  'match.update_score',
  'goal.create',
  'goal.update',
  'goal.delete',
  'goal.bulk_create',
  'card.create',
  'card.update',
  'card.delete',
  'card.bulk_create',
  'suspension.recalculate',
];

const LIMIT = 50;

function fmt(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime())
    ? ts
    : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AuditLogsPage() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (entityType) params.set('entityType', entityType);
      if (action) params.set('action', action);
      if (adminEmail.trim()) params.set('adminEmail', adminEmail.trim());
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'โหลดข้อมูลไม่สำเร็จ');
      }
      const data = await res.json();
      setRows(data.rows);
      setTotal(data.total);
      setPage(data.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }, [entityType, action, adminEmail, dateFrom, dateTo, search]);

  useEffect(() => {
    load(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const selectClass =
    'px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">🧾 Audit Logs</h1>
        <p className="text-slate-600 mt-1 text-sm">บันทึกการกระทำของแอดมิน (อ่านอย่างเดียว)</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Entity</label>
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className={`${selectClass} w-full`}>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>{t || 'ทั้งหมด'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Action</label>
            <select value={action} onChange={(e) => setAction(e.target.value)} className={`${selectClass} w-full`}>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{a || 'ทั้งหมด'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Admin email</label>
            <input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="email..." className={`${selectClass} w-full`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">จากวันที่</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${selectClass} w-full`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">ถึงวันที่</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${selectClass} w-full`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">ค้นหา</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="label / action / email" className={`${selectClass} w-full`} />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => load(1)} disabled={loading} className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-lg text-sm font-semibold">
            {loading ? '⏳ กำลังโหลด...' : '🔍 ค้นหา'}
          </button>
          <button
            onClick={() => {
              setEntityType(''); setAction(''); setAdminEmail(''); setDateFrom(''); setDateTo(''); setSearch('');
              setTimeout(() => load(1), 0);
            }}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold"
          >
            ล้างตัวกรอง
          </button>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">❌ {error}</div>}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white text-xs">
                <th className="px-3 py-3 text-left">เวลา</th>
                <th className="px-3 py-3 text-left">Admin</th>
                <th className="px-3 py-3 text-left">Action</th>
                <th className="px-3 py-3 text-left">Entity</th>
                <th className="px-3 py-3 text-left">รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-slate-400">ไม่พบบันทึก</td></tr>
              ) : (
                rows.map((r, i) => {
                  const isOpen = expanded === r.id;
                  return (
                    <>
                      <tr
                        key={r.id}
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${i % 2 ? 'bg-slate-50/50' : 'bg-white'}`}
                      >
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{fmt(r.created_at)}</td>
                        <td className="px-3 py-2.5 text-slate-700">{r.admin_email || '—'}</td>
                        <td className="px-3 py-2.5"><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{r.action}</span></td>
                        <td className="px-3 py-2.5 text-slate-600">{r.entity_type}</td>
                        <td className="px-3 py-2.5 text-slate-700">{r.entity_label || '—'}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${r.id}-d`} className="bg-slate-50">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <p className="text-xs font-semibold text-slate-500 mb-1">old_data</p>
                                <pre className="text-xs bg-white border border-slate-200 rounded p-2 overflow-x-auto">{r.old_data ? JSON.stringify(r.old_data, null, 2) : '—'}</pre>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-500 mb-1">new_data</p>
                                <pre className="text-xs bg-white border border-slate-200 rounded p-2 overflow-x-auto">{r.new_data ? JSON.stringify(r.new_data, null, 2) : '—'}</pre>
                              </div>
                            </div>
                            <p className="text-xs text-slate-400 mt-2">entity_id: {r.entity_id || '—'}</p>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">ทั้งหมด {total} รายการ · หน้า {page}/{totalPages}</span>
        <div className="flex gap-2">
          <button onClick={() => load(page - 1)} disabled={page <= 1 || loading} className="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-100">← ก่อนหน้า</button>
          <button onClick={() => load(page + 1)} disabled={page >= totalPages || loading} className="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-100">ถัดไป →</button>
        </div>
      </div>
    </div>
  );
}

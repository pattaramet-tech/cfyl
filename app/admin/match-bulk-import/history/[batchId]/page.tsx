'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import type { MatchBulkImportBatch, MatchBulkImportBatchRow } from '@/types/bulk-import';

interface BatchDetail {
  batch: MatchBulkImportBatch;
  rows: MatchBulkImportBatchRow[];
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'success'
      ? 'bg-green-100 text-green-700 border-green-200'
      : status === 'partial'
        ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
        : 'bg-red-100 text-red-700 border-red-200';

  const label =
    status === 'success'
      ? 'สำเร็จ'
      : status === 'partial'
        ? 'สำเร็จบางส่วน'
        : 'ล้มเหลว';

  return <span className={`inline-block px-2 py-1 text-xs font-semibold rounded-full border ${cls}`}>{label}</span>;
}

function RowStatusBadge({ status }: { status: string }) {
  const cls =
    status === 'success'
      ? 'bg-green-100 text-green-700'
      : status === 'warning'
        ? 'bg-yellow-100 text-yellow-700'
        : status === 'failed'
          ? 'bg-red-100 text-red-700'
          : 'bg-gray-100 text-gray-700';

  return <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${cls}`}>{status}</span>;
}

export default function BatchDetailPage() {
  const params = useParams();
  const batchId = params.batchId as string;

  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sheetFilter, setSheetFilter] = useState('all');

  useEffect(() => {
    const loadDetail = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(`/api/admin/match-bulk/history/${batchId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load batch');
        }

        const data: BatchDetail = await res.json();
        setDetail(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    loadDetail();
  }, [batchId]);

  const sheets = useMemo(() => {
    if (!detail) return [];
    return ['all', ...new Set(detail.rows.map((r) => r.sheet_name))];
  }, [detail]);

  const filteredRows = useMemo(() => {
    if (!detail) return [];
    return detail.rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (sheetFilter !== 'all' && row.sheet_name !== sheetFilter) return false;
      return true;
    });
  }, [detail, statusFilter, sheetFilter]);

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">กำลังโหลด...</p>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 md:p-6">
        <Link href="/admin/match-bulk-import/history" className="text-blue-600 hover:underline mb-4 inline-block">
          ← กลับไปประวัติ
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
          {error || 'ไม่พบข้อมูล'}
        </div>
      </div>
    );
  }

  const batch = detail.batch;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/match-bulk-import/history" className="text-blue-600 hover:underline mb-4 inline-block font-semibold">
          ← กลับไปประวัติ
        </Link>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-3xl font-bold">Import Batch Detail</h1>
          <StatusBadge status={batch.status} />
        </div>
      </div>

      {/* Summary Info */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <p className="text-sm text-gray-500">Batch No</p>
            <p className="text-lg font-bold font-mono">{batch.batch_no}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Date</p>
            <p className="text-lg font-bold">
              {new Date(batch.created_at).toLocaleDateString('th-TH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">File</p>
            <p className="text-lg font-bold">{batch.file_name || '-'}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Scope</p>
            <p className="text-sm">
              {batch.season?.name} / {batch.age_group?.name}
              {batch.division?.name && ` / ${batch.division.name}`}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Admin</p>
            <p className="text-sm">{batch.created_by_email || '-'}</p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mb-6">
        <h2 className="text-lg font-bold mb-3">📊 Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <p className="text-2xl font-bold text-blue-600">{batch.matches_updated}</p>
            <p className="text-xs text-gray-600">Matches Updated</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 border border-green-200">
            <p className="text-2xl font-bold text-green-600">{batch.goals_inserted}</p>
            <p className="text-xs text-gray-600">Goals Inserted</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
            <p className="text-2xl font-bold text-yellow-600">{batch.cards_inserted}</p>
            <p className="text-xs text-gray-600">Cards Inserted</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
            <p className="text-2xl font-bold text-purple-600">{batch.staff_discipline_inserted}</p>
            <p className="text-xs text-gray-600">Staff Discipline</p>
          </div>
          <div className="bg-pink-50 rounded-lg p-3 border border-pink-200">
            <p className="text-2xl font-bold text-pink-600">{batch.players_updated}</p>
            <p className="text-xs text-gray-600">Players Updated</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-200">
            <p className="text-2xl font-bold text-indigo-600">{batch.suspensions_recalculated}</p>
            <p className="text-xs text-gray-600">Suspensions Recalc</p>
          </div>
          <div className="bg-red-50 rounded-lg p-3 border border-red-200">
            <p className="text-2xl font-bold text-red-600">{batch.warnings_count}</p>
            <p className="text-xs text-gray-600">Warnings</p>
          </div>
          <div className="bg-red-100 rounded-lg p-3 border border-red-300">
            <p className="text-2xl font-bold text-red-700">{batch.errors_count}</p>
            <p className="text-xs text-gray-600">Errors</p>
          </div>
        </div>
      </div>

      {/* Row Details */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">📋 Row Details ({filteredRows.length})</h2>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="all">ทั้งหมด</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="failed">Failed</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sheet</label>
            <select
              value={sheetFilter}
              onChange={(e) => setSheetFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              {sheets.map((sheet) => (
                <option key={sheet} value={sheet}>
                  {sheet === 'all' ? 'ทั้งหมด' : sheet}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {filteredRows.length === 0 ? (
            <div className="text-center py-8 text-gray-500">ไม่พบรายการ</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Sheet</th>
                    <th className="px-4 py-3 text-left font-medium">Row</th>
                    <th className="px-4 py-3 text-left font-medium">Action</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-mono">{row.sheet_name}</td>
                      <td className="px-4 py-3 text-xs">{row.row_number || '-'}</td>
                      <td className="px-4 py-3 text-xs">{row.action}</td>
                      <td className="px-4 py-3">
                        <RowStatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 text-xs max-w-md">
                        <div className="truncate">{row.message || '-'}</div>
                        {row.error && <div className="text-red-600 mt-1">Error: {row.error}</div>}
                        {(row.raw_data || row.resolved_data) && (
                          <details className="mt-2">
                            <summary className="text-blue-600 font-semibold cursor-pointer text-xs">
                              ดูข้อมูล
                            </summary>
                            <pre className="mt-2 bg-slate-900 text-slate-100 p-2 rounded text-xs overflow-auto max-h-48 whitespace-pre-wrap break-words">
                              {JSON.stringify({ raw: row.raw_data, resolved: row.resolved_data }, null, 2)}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

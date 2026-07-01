'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MatchBulkImportBatch } from '@/types/bulk-import';

interface Season {
  id: string;
  name: string;
}

interface AgeGroup {
  id: string;
  code: string;
  name: string;
}

interface Division {
  id: string;
  name: string;
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

export default function ImportHistoryPage() {
  const router = useRouter();

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('');

  const [batches, setBatches] = useState<MatchBulkImportBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load seasons
  useEffect(() => {
    const loadSeasons = async () => {
      try {
        const res = await fetch('/api/public/seasons');
        const data = await res.json();
        setSeasons(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length > 0) {
          setSelectedSeason(data[0].id);
        }
      } catch (err) {
        console.error('Error loading seasons:', err);
      }
    };
    loadSeasons();
  }, []);

  // Load age groups
  useEffect(() => {
    if (!selectedSeason) return;

    const loadAgeGroups = async () => {
      try {
        const res = await fetch(`/api/public/age-groups?seasonId=${selectedSeason}`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setAgeGroups(list);
        setSelectedAgeGroup(list.length > 0 ? list[0].id : '');
        setSelectedDivision('');
        setDivisions([]);
      } catch (err) {
        console.error('Error loading age groups:', err);
      }
    };
    loadAgeGroups();
  }, [selectedSeason]);

  // Load divisions
  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup) return;

    const loadDivisions = async () => {
      try {
        const res = await fetch(
          `/api/public/divisions?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`
        );
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setDivisions(list);
        setSelectedDivision('');
      } catch (err) {
        console.error('Error loading divisions:', err);
      }
    };
    loadDivisions();
  }, [selectedSeason, selectedAgeGroup]);

  const handleLoadHistory = async () => {
    if (!selectedSeason || !selectedAgeGroup) {
      alert('กรุณาเลือกฤดูกาลและระดับอายุ');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams({
        seasonId: selectedSeason,
        ageGroupId: selectedAgeGroup,
        ...(selectedDivision && { divisionId: selectedDivision }),
      });

      const res = await fetch(`/api/admin/match-bulk/history?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load history');
      }

      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setBatches([]);
      } else {
        setBatches(Array.isArray(data.data) ? data.data : []);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setBatches([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold">📜 Import History</h1>
          <Link
            href="/admin/match-bulk-import"
            className="px-3 py-2 text-sm text-blue-600 hover:underline font-semibold"
          >
            ← Bulk Import
          </Link>
        </div>
        <p className="text-gray-600">ประวัติการนำเข้าข้อมูล Match Bulk Import</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ฤดูกาล</label>
            <select
              value={selectedSeason}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">เลือกฤดูกาล</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ระดับอายุ</label>
            <select
              value={selectedAgeGroup}
              onChange={(e) => setSelectedAgeGroup(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              disabled={!selectedSeason}
            >
              <option value="">เลือกระดับอายุ</option>
              {ageGroups.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ดิวิชั่น</label>
            <select
              value={selectedDivision}
              onChange={(e) => setSelectedDivision(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              disabled={!selectedAgeGroup}
            >
              <option value="">ทั้งหมด</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleLoadHistory}
              disabled={!selectedSeason || !selectedAgeGroup || loading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 font-semibold text-sm transition"
            >
              {loading ? 'กำลังโหลด...' : '🔍 ค้นหา'}
            </button>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
          {error}
        </div>
      )}

      {/* History Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {batches.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {loading ? 'กำลังโหลด...' : 'ไม่พบประวัติ Import'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Batch No</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">File</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-center font-medium">Data</th>
                  <th className="px-4 py-3 text-center font-medium">W/E</th>
                  <th className="px-4 py-3 text-left font-medium">By</th>
                  <th className="px-4 py-3 text-center font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{batch.batch_no}</td>
                    <td className="px-4 py-3 text-xs">
                      {new Date(batch.created_at).toLocaleDateString('th-TH', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-xs">{batch.file_name || '-'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={batch.status} />
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      M:{batch.matches_updated} G:{batch.goals_inserted} C:{batch.cards_inserted} S:{batch.staff_discipline_inserted} P:{batch.players_updated}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {batch.warnings_count > 0 && <span className="text-yellow-600 font-semibold">{batch.warnings_count}</span>}
                      {batch.warnings_count === 0 && <span className="text-gray-400">-</span>}
                      /
                      {batch.errors_count > 0 && <span className="text-red-600 font-semibold">{batch.errors_count}</span>}
                      {batch.errors_count === 0 && <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">{batch.created_by_email || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/admin/match-bulk-import/history/${batch.id}`}
                        className="text-blue-600 hover:text-blue-900 font-medium text-xs"
                      >
                        ดูรายละเอียด
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-600">
          ทั้งหมด {batches.length} รายการ
        </div>
      </div>
    </div>
  );
}

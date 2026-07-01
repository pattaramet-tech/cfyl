'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BulkImportPreviewResponse, BulkImportRowResult, BulkImportApplyResponse } from '@/types/bulk-import';

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

export default function MatchBulkImportPage() {
  const router = useRouter();

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<BulkImportPreviewResponse | null>(null);
  const [applyResult, setApplyResult] = useState<BulkImportApplyResponse | null>(null);
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

  const handleDownloadTemplate = async () => {
    if (!selectedSeason || !selectedAgeGroup) {
      alert('กรุณาเลือกฤดูกาลและระดับอายุ');
      return;
    }

    try {
      const params = new URLSearchParams({
        seasonId: selectedSeason,
        ageGroupId: selectedAgeGroup,
        ...(selectedDivision && { divisionId: selectedDivision }),
      });

      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/match-bulk/template?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cfyl-match-bulk-template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleExportCurrentData = async () => {
    if (!selectedSeason || !selectedAgeGroup) {
      alert('กรุณาเลือกฤดูกาลและระดับอายุ');
      return;
    }

    try {
      const params = new URLSearchParams({
        seasonId: selectedSeason,
        ageGroupId: selectedAgeGroup,
        ...(selectedDivision && { divisionId: selectedDivision }),
      });

      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/match-bulk/export-current?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = res.headers.get('content-disposition')?.split('filename="')[1]?.split('"')[0] ||
        `cfyl-current-data-${selectedAgeGroup}.xlsx`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handlePreview = async () => {
    if (!file) {
      alert('กรุณาเลือกไฟล์');
      return;
    }

    if (!selectedSeason || !selectedAgeGroup) {
      alert('กรุณาเลือกฤดูกาลและระดับอายุ');
      return;
    }

    setLoading(true);
    setError(null);
    setPreviewData(null);

    try {
      const token = localStorage.getItem('admin_token');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('seasonId', selectedSeason);
      formData.append('ageGroupId', selectedAgeGroup);
      if (selectedDivision) {
        formData.append('divisionId', selectedDivision);
      }

      const res = await fetch('/api/admin/match-bulk/preview', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Preview failed');
      }

      const data: BulkImportPreviewResponse = await res.json();
      setPreviewData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!previewData || !previewData.canApply) {
      alert('ไม่สามารถ apply ได้ มี error rows');
      return;
    }

    const confirmed = window.confirm(
      `ต้องการนำเข้าข้อมูลจริงใช่ไหม?\n\nจะเพิ่ม:\n- Match: ${previewData.summary.matches}\n- Goals: ${previewData.summary.goals}\n- Cards: ${previewData.summary.cards}\n- Staff Discipline: ${previewData.summary.staffDiscipline}\n- Player Updates: ${previewData.summary.playerUpdates}\n\nข้อมูล Goals/Cards/StaffDiscipline จะถูกเพิ่มใหม่ ไม่ลบของเดิม`
    );

    if (!confirmed) return;

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/match-bulk/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          seasonId: selectedSeason,
          ageGroupId: selectedAgeGroup,
          divisionId: selectedDivision,
          rows: previewData.rows,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Apply failed');
      }

      const data: BulkImportApplyResponse = await res.json();
      setApplyResult(data);
      setPreviewData(null);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setLoading(false);
    }
  };

  const getResultRowColor = (status: string) => {
    switch (status) {
      case 'valid':
        return 'bg-green-50 border-green-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-white border-gray-200';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'valid':
        return <span className="inline-block px-2 py-1 bg-green-100 text-green-800 text-xs rounded">✓ Valid</span>;
      case 'warning':
        return <span className="inline-block px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded">⚠ Warning</span>;
      case 'error':
        return <span className="inline-block px-2 py-1 bg-red-100 text-red-800 text-xs rounded">✗ Error</span>;
      default:
        return null;
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">📥 Bulk Import Center</h1>
        <p className="text-gray-600">Import ข้อมูลแมตช์จำนวนมากจากไฟล์ Excel</p>
      </div>

      {/* Warning Message */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
        <div className="flex gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="font-semibold text-amber-900 mb-2">หมายเหตุสำคัญ</p>
            <ul className="text-sm text-amber-800 space-y-1">
              <li>• <strong>Matches</strong> และ <strong>PlayerUpdates</strong> สามารถแก้ข้อมูลเดิมได้</li>
              <li>• <strong>Goals / Cards / StaffDiscipline</strong> ใน Phase 1 เป็น <strong>Append Only</strong></li>
              <li>• ถ้านำ Current Data ที่มี event เดิมกลับเข้าไป จะเกิดข้อมูลซ้ำ</li>
              <li>• หากต้องการแก้ event เดิม ให้แก้ใน Match Management หรือรอ Replace Mode (Phase 2)</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Season */}
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

          {/* Age Group */}
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

          {/* Division */}
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

          {/* Download & History Buttons */}
          <div className="col-span-1 md:col-span-3 flex items-end gap-2">
            <button
              onClick={handleDownloadTemplate}
              disabled={!selectedSeason || !selectedAgeGroup}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 font-semibold text-sm transition"
            >
              📄 Blank Template
            </button>
            <button
              onClick={handleExportCurrentData}
              disabled={!selectedSeason || !selectedAgeGroup}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 font-semibold text-sm transition"
            >
              📥 Current Data
            </button>
            <Link
              href="/admin/match-bulk-import/history"
              className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800 font-semibold text-sm transition text-center"
            >
              📜 History
            </Link>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      {!applyResult && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">เลือกไฟล์ Excel</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setError(null);
              }}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {file && <p className="text-sm text-gray-600 mt-2">เลือกแล้ว: {file.name}</p>}
          </div>

          <button
            onClick={handlePreview}
            disabled={!file || loading || !selectedSeason || !selectedAgeGroup}
            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 font-semibold transition"
          >
            {loading ? 'กำลังตรวจสอบ...' : '👁️ Preview Import'}
          </button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
          ✗ {error}
        </div>
      )}

      {/* Preview Results */}
      {previewData && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-bold mb-4">📊 Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="text-center p-3 bg-blue-50 rounded">
                <div className="text-2xl font-bold text-blue-600">{previewData.summary.matches}</div>
                <div className="text-xs text-gray-600">Matches</div>
              </div>
              <div className="text-center p-3 bg-green-50 rounded">
                <div className="text-2xl font-bold text-green-600">{previewData.summary.goals}</div>
                <div className="text-xs text-gray-600">Goals</div>
              </div>
              <div className="text-center p-3 bg-yellow-50 rounded">
                <div className="text-2xl font-bold text-yellow-600">{previewData.summary.cards}</div>
                <div className="text-xs text-gray-600">Cards</div>
              </div>
              <div className="text-center p-3 bg-purple-50 rounded">
                <div className="text-2xl font-bold text-purple-600">{previewData.summary.staffDiscipline}</div>
                <div className="text-xs text-gray-600">Staff Disc</div>
              </div>
              <div className="text-center p-3 bg-pink-50 rounded">
                <div className="text-2xl font-bold text-pink-600">{previewData.summary.playerUpdates}</div>
                <div className="text-xs text-gray-600">Players</div>
              </div>
              <div className="text-center p-3 bg-red-50 rounded">
                <div className="text-2xl font-bold text-red-600">{previewData.summary.errors}</div>
                <div className="text-xs text-gray-600">Errors</div>
              </div>
            </div>
          </div>

          {/* Result Rows */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-bold mb-4">📋 Details ({previewData.rows.length} rows)</h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {previewData.rows.map((row, idx) => (
                <div key={idx} className={`p-3 border rounded ${getResultRowColor(row.status)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-600">
                          {row.sheet}:{row.rowNumber}
                        </span>
                        {getStatusBadge(row.status)}
                      </div>
                      <p className="text-sm mt-1">{row.message}</p>
                      {row.resolved && (
                        <details className="text-xs text-gray-600 mt-1">
                          <summary>Resolved data</summary>
                          <pre className="mt-1 p-2 bg-gray-100 rounded text-xs overflow-auto">
                            {JSON.stringify(row.resolved, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Apply Button */}
          <div className="flex gap-3">
            {previewData.canApply ? (
              <>
                <button
                  onClick={handleApply}
                  disabled={loading}
                  className="px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 font-semibold transition"
                >
                  {loading ? 'กำลังนำเข้า...' : '✅ Apply Import'}
                </button>
                <button
                  onClick={() => {
                    setPreviewData(null);
                    setFile(null);
                  }}
                  className="px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-semibold transition"
                >
                  ← Back
                </button>
              </>
            ) : (
              <div className="text-red-600 font-semibold">⚠️ มี error rows ต้องแก้ก่อน</div>
            )}
          </div>
        </div>
      )}

      {/* Apply Result */}
      {applyResult && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className={applyResult.success ? 'text-green-600' : 'text-red-600'}>
            <h2 className="text-xl font-bold mb-2">{applyResult.success ? '✅ Success!' : '❌ Failed'}</h2>
            <p>{applyResult.message}</p>
          </div>

          {/* Batch Log Info */}
          {applyResult.batchId && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-4">
              <p className="font-semibold">📜 บันทึกประวัติ Import แล้ว</p>
              <p className="text-sm">Batch: {applyResult.batchNo}</p>
              <Link
                href={`/admin/match-bulk-import/history/${applyResult.batchId}`}
                className="inline-block mt-2 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 font-semibold"
              >
                ดูรายละเอียด →
              </Link>
            </div>
          )}

          {/* Log Warning */}
          {applyResult.logWarning && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-4">
              ⚠️ {applyResult.logWarning}
            </div>
          )}

          {/* Summary */}
          <div className="bg-gray-50 p-4 rounded">
            <h3 className="font-semibold mb-2">📊 Results:</h3>
            <ul className="space-y-1 text-sm">
              <li>Matches updated: {applyResult.summary.matchesUpdated}</li>
              <li>Goals inserted: {applyResult.summary.goalsInserted}</li>
              <li>Cards inserted: {applyResult.summary.cardsInserted}</li>
              <li>Staff discipline inserted: {applyResult.summary.staffDisciplineInserted}</li>
              <li>Players updated: {applyResult.summary.playersUpdated}</li>
              <li>Players affected for suspension recalc: {applyResult.summary.affectedPlayersForSuspension.length}</li>
            </ul>
          </div>

          {/* Error Rows */}
          {applyResult.errors.length > 0 && (
            <div className="bg-red-50 p-4 rounded">
              <h3 className="font-semibold text-red-800 mb-2">⚠️ Errors ({applyResult.errors.length}):</h3>
              <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
                {applyResult.errors.map((err, idx) => (
                  <p key={idx} className="text-red-600">
                    {err.sheet}:{err.rowNumber} - {err.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Next Steps */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/admin/data-quality"
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold transition text-center"
            >
              🧪 Data Quality Checker
            </Link>
            <Link
              href="/admin/matches/manage"
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold transition text-center"
            >
              ⚙️ Match Management
            </Link>
            <button
              onClick={() => {
                setApplyResult(null);
                setFile(null);
                setPreviewData(null);
              }}
              className="px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-semibold transition"
            >
              ← Back to Upload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

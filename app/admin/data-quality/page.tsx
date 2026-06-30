'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

type QualitySeverity = 'error' | 'warning' | 'info';

interface QualityIssue {
  id: string;
  severity: QualitySeverity;
  category: string;
  title: string;
  description: string;
  entity_type: string;
  entity_id?: string | null;
  match_id?: string | null;
  team_id?: string | null;
  action_url?: string | null;
  meta?: Record<string, any>;
}

interface QualitySummary {
  errors: number;
  warnings: number;
  infos: number;
  total: number;
}

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

export default function DataQualityPage() {
  const router = useRouter();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('');

  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const [severityFilter, setSeverityFilter] = useState<'all' | QualitySeverity>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load seasons on mount
  useEffect(() => {
    const loadSeasons = async () => {
      try {
        const res = await fetch('/api/public/seasons');
        if (!res.ok) throw new Error('Failed to load seasons');

        const data = await res.json();
        setSeasons(Array.isArray(data) ? data : []);

        if (Array.isArray(data) && data.length > 0) {
          setSelectedSeason(data[0].id);
        }
        setLoadError(null);
      } catch (error) {
        console.error('Error loading seasons:', error);
        setLoadError('ไม่สามารถโหลดฤดูกาลได้');
      }
    };

    loadSeasons();
  }, []);

  // Load age groups when season changes
  useEffect(() => {
    if (!selectedSeason) return;

    const loadAgeGroups = async () => {
      try {
        const res = await fetch(`/api/public/age-groups?seasonId=${selectedSeason}`);
        if (!res.ok) throw new Error('Failed to load age groups');

        const data = await res.json();
        const list = Array.isArray(data) ? data : [];

        setAgeGroups(list);
        setSelectedAgeGroup(list.length > 0 ? list[0].id : '');
        setSelectedDivision('');
        setDivisions([]);
        setSummary(null);
        setIssues([]);
        setChecked(false);
        setLoadError(null);
      } catch (error) {
        console.error('Error loading age groups:', error);
        setLoadError('ไม่สามารถโหลดระดับอายุได้');
      }
    };

    loadAgeGroups();
  }, [selectedSeason]);

  // Load divisions when age group changes
  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup) return;

    const loadDivisions = async () => {
      try {
        const res = await fetch(
          `/api/public/divisions?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`
        );
        if (!res.ok) throw new Error('Failed to load divisions');

        const data = await res.json();
        const list = Array.isArray(data) ? data : [];

        setDivisions(list);
        setSelectedDivision('');
        setSummary(null);
        setIssues([]);
        setChecked(false);
        setLoadError(null);
      } catch (error) {
        console.error('Error loading divisions:', error);
        setLoadError('ไม่สามารถโหลดดิวิชั่นได้');
      }
    };

    loadDivisions();
  }, [selectedSeason, selectedAgeGroup]);

  const handleCheck = useCallback(async () => {
    if (!selectedSeason || !selectedAgeGroup) return;

    setLoading(true);
    setLoadError(null);
    try {
      const token = localStorage.getItem('admin_token');
      if (!token) {
        router.push('/admin/login');
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };

      const params = new URLSearchParams({
        seasonId: selectedSeason,
        ageGroupId: selectedAgeGroup,
        ...(selectedDivision && { divisionId: selectedDivision }),
      });

      const res = await fetch(`/api/admin/data-quality?${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setIssues(data.issues);
        setChecked(true);
      }
    } catch (error) {
      console.error('Error checking data quality:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedSeason, selectedAgeGroup, selectedDivision]);

  const categories = useMemo(
    () => ['all', ...new Set(issues.map((i) => i.category))],
    [issues]
  );

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (severityFilter !== 'all' && issue.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && issue.category !== categoryFilter) return false;
      if (
        searchText &&
        !issue.title.toLowerCase().includes(searchText.toLowerCase()) &&
        !issue.description.toLowerCase().includes(searchText.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [issues, severityFilter, categoryFilter, searchText]);

  const getSeverityColor = (severity: QualitySeverity) => {
    switch (severity) {
      case 'error':
        return 'bg-red-100 text-red-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'info':
        return 'bg-blue-100 text-blue-800';
    }
  };

  const getSeverityBadge = (severity: QualitySeverity) => {
    switch (severity) {
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">🧪 Data Quality Checker</h1>
        <p className="text-gray-600">ตรวจความครบถ้วนและความถูกต้องของข้อมูลการแข่งขัน</p>
      </div>

      {/* Error message */}
      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">
          {loadError}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Season */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ฤดูกาล
            </label>
            <select
              value={selectedSeason}
              onChange={(e) => {
                setSelectedSeason(e.target.value);
                setSelectedAgeGroup('');
              }}
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ระดับอายุ
            </label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ดิวิชั่น
            </label>
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

          {/* Buttons */}
          <div className="flex items-end gap-2">
            <button
              onClick={handleCheck}
              disabled={!selectedSeason || !selectedAgeGroup || loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 font-semibold text-sm transition"
            >
              {loading ? 'กำลังตรวจสอบ...' : '✓ ตรวจสอบ'}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm transition"
            >
              🔄
            </button>
          </div>
        </div>
      </div>

      {/* Summary */}
      {checked && summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-red-50 rounded-lg p-4 border-l-4 border-red-500">
            <p className="text-red-800 font-semibold text-2xl">{summary.errors}</p>
            <p className="text-red-600 text-sm">Errors</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-4 border-l-4 border-yellow-500">
            <p className="text-yellow-800 font-semibold text-2xl">{summary.warnings}</p>
            <p className="text-yellow-600 text-sm">Warnings</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4 border-l-4 border-blue-500">
            <p className="text-blue-800 font-semibold text-2xl">{summary.infos}</p>
            <p className="text-blue-600 text-sm">Info</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border-l-4 border-gray-500">
            <p className="text-gray-800 font-semibold text-2xl">{summary.total}</p>
            <p className="text-gray-600 text-sm">Total Issues</p>
          </div>
        </div>
      )}

      {/* Issue Filters */}
      {checked && (
        <div className="bg-white rounded-lg shadow p-4 mb-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Severity Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Severity
              </label>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="all">ทั้งหมด</option>
                <option value="error">❌ Error</option>
                <option value="warning">⚠️ Warning</option>
                <option value="info">ℹ️ Info</option>
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat === 'all' ? 'ทั้งหมด' : cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ค้นหา
              </label>
              <input
                type="text"
                placeholder="ค้นหาเรื่อง..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* Issues List */}
      {checked && filteredIssues.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 text-lg">✨ ไม่พบปัญหาในข้อมูล</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredIssues.map((issue) => (
            <div
              key={issue.id}
              className="bg-white rounded-lg shadow p-4 border-l-4"
              style={{
                borderLeftColor:
                  issue.severity === 'error'
                    ? '#ef4444'
                    : issue.severity === 'warning'
                      ? '#eab308'
                      : '#3b82f6',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{getSeverityBadge(issue.severity)}</span>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${getSeverityColor(issue.severity)}`}>
                      {issue.severity === 'error' ? 'Error' : issue.severity === 'warning' ? 'Warning' : 'Info'}
                    </span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                      {issue.category}
                    </span>
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">{issue.title}</h3>
                  <p className="text-sm text-gray-600">{issue.description}</p>
                </div>
                {issue.action_url && (
                  <a
                    href={issue.action_url}
                    className="px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm font-semibold whitespace-nowrap transition"
                  >
                    ไปแก้ไข →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {checked && summary && summary.total > 0 && (
        <div className="mt-6 text-center text-sm text-gray-500">
          แสดง {filteredIssues.length} ของ {issues.length} ปัญหา
        </div>
      )}
    </div>
  );
}

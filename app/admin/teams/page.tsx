'use client';

import { useEffect, useState } from 'react';

interface Season { id: string; name: string; year: number; competition_type?: 'league' | 'tournament' | 'mixed'; }
interface AgeGroup { id: string; code: string; name: string; }
interface Division { id: string; name: string; sort_order: number; }

interface Team {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  team_color: string | null;
  active: boolean;
  season_id: string;
  age_group_id: string;
  division_id: string | null;
  division: { id: string; name: string; sort_order: number } | null;
  player_count: number;
}

interface FormData {
  name: string;
  short_name: string;
  division_id: string;
  logo_url: string;
  team_color: string;
  use_color: boolean;
  active: boolean;
}

const EMPTY_FORM: FormData = {
  name: '',
  short_name: '',
  division_id: '',
  logo_url: '',
  team_color: '#3b82f6',
  use_color: false,
  active: true,
};

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_token');
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function TeamColorBadge({ color, logoUrl, name }: { color: string | null; logoUrl: string | null; name: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        className="w-7 h-7 object-contain rounded"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  if (color) {
    return (
      <span
        className="inline-block w-5 h-5 rounded-full border border-gray-200"
        style={{ backgroundColor: color }}
        title={color}
      />
    );
  }
  return <span className="inline-block w-5 h-5 rounded-full bg-gray-200" title="ไม่มีสี" />;
}

export default function AdminTeamsPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');
  const [filterDivision, setFilterDivision] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [isLoadingSeasons, setIsLoadingSeasons] = useState(true);
  const [isLoadingAgeGroups, setIsLoadingAgeGroups] = useState(false);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(false);
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form
  const [formMode, setFormMode] = useState<'closed' | 'add' | 'edit'>('closed');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [logoPreviewError, setLogoPreviewError] = useState(false);

  // Load seasons
  useEffect(() => {
    fetch('/api/public/seasons')
      .then((r) => r.json())
      .then((data) => {
        setSeasons(data);
        if (data.length > 0) setSelectedSeason(data[0].id);
      })
      .catch(() => setPageError('โหลด Season ล้มเหลว'))
      .finally(() => setIsLoadingSeasons(false));
  }, []);

  // Load age groups when season changes
  useEffect(() => {
    if (!selectedSeason) return;
    setIsLoadingAgeGroups(true);
    setSelectedAgeGroup('');
    setAgeGroups([]);
    setDivisions([]);
    setTeams([]);

    fetch(`/api/public/age-groups?seasonId=${selectedSeason}`)
      .then((r) => r.json())
      .then((data) => {
        setAgeGroups(data);
        if (data.length > 0) setSelectedAgeGroup(data[0].id);
      })
      .catch(() => setPageError('โหลด Age Group ล้มเหลว'))
      .finally(() => setIsLoadingAgeGroups(false));
  }, [selectedSeason]);

  // Load divisions + teams when age group changes
  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup) return;
    setFilterDivision('');
    setSearchQuery('');
    loadDivisions();
    loadTeams();
  }, [selectedSeason, selectedAgeGroup]);

  const loadDivisions = async () => {
    setIsLoadingDivisions(true);
    try {
      const res = await fetch(
        `/api/public/divisions?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`
      );
      const data = await res.json();
      setDivisions(data);
    } catch {
      // non-critical
    } finally {
      setIsLoadingDivisions(false);
    }
  };

  const loadTeams = async () => {
    if (!selectedSeason || !selectedAgeGroup) return;
    setIsLoadingTeams(true);
    setPageError(null);
    try {
      const token = getToken();
      const res = await fetch(
        `/api/admin/teams?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`,
        { headers: authHeaders(token) }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Unauthorized');
      }
      setTeams(await res.json());
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'โหลดข้อมูลทีมล้มเหลว');
    } finally {
      setIsLoadingTeams(false);
    }
  };

  // Client-side filter
  const filteredTeams = teams.filter((t) => {
    if (!showInactive && !t.active) return false;
    if (filterDivision && t.division_id !== filterDivision) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        (t.short_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeCount = teams.filter((t) => t.active).length;
  const inactiveCount = teams.filter((t) => !t.active).length;

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  // Form handlers
  const openAddForm = () => {
    setFormMode('add');
    setEditingTeamId(null);
    setFormData({
      ...EMPTY_FORM,
      division_id: filterDivision || (divisions[0]?.id ?? ''),
    });
    setFormError(null);
    setLogoPreviewError(false);
  };

  const openEditForm = (team: Team) => {
    setFormMode('edit');
    setEditingTeamId(team.id);
    setFormData({
      name: team.name,
      short_name: team.short_name || '',
      division_id: team.division_id || '',
      logo_url: team.logo_url || '',
      team_color: team.team_color || '#3b82f6',
      use_color: !!team.team_color,
      active: team.active,
    });
    setFormError(null);
    setLogoPreviewError(false);
  };

  const closeForm = () => {
    setFormMode('closed');
    setEditingTeamId(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
    setLogoPreviewError(false);
  };

  const handleFormChange = (field: keyof FormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === 'logo_url') setLogoPreviewError(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFormError('กรุณากรอกชื่อทีม');
      return;
    }
    if (divisionRequired && !formData.division_id) {
      setFormError('กรุณาเลือกดิวิชั่น');
      return;
    }

    setFormLoading(true);
    setFormError(null);

    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    };

    const payload = {
      name: formData.name.trim(),
      short_name: formData.short_name.trim() || null,
      division_id: compType === 'tournament' ? null : (formData.division_id || null),
      season_id: selectedSeason,
      age_group_id: selectedAgeGroup,
      logo_url: formData.logo_url.trim() || null,
      team_color: formData.use_color ? formData.team_color : null,
      ...(formMode === 'edit' ? { active: formData.active } : {}),
    };

    try {
      if (formMode === 'add') {
        const res = await fetch('/api/admin/teams', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'เพิ่มทีมล้มเหลว');
        showSuccess(`✅ เพิ่มทีม "${data.name}" สำเร็จ`);
        setFormData({ ...EMPTY_FORM, division_id: formData.division_id });
      } else if (formMode === 'edit' && editingTeamId) {
        const res = await fetch(`/api/admin/teams/${editingTeamId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'แก้ไขทีมล้มเหลว');
        showSuccess(`✅ แก้ไขทีม "${data.name}" สำเร็จ`);
        closeForm();
      }
      await loadTeams();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (team: Team) => {
    const newActive = !team.active;
    const label = newActive ? 'เปิดการใช้งาน' : 'ปิดการใช้งาน';
    if (!confirm(`ต้องการ${label} "${team.name}" ใช่หรือไม่?`)) return;

    const token = getToken();
    try {
      const res = await fetch(`/api/admin/teams/${team.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ active: newActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ล้มเหลว');
      showSuccess(`✅ ${label} "${team.name}" สำเร็จ`);
      setTeams((prev) =>
        prev.map((t) => (t.id === team.id ? { ...t, active: newActive } : t))
      );
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    }
  };

  const handleDelete = async (team: Team) => {
    if (
      !confirm(`ต้องการลบทีม "${team.name}" ออกจากระบบ?\n⚠️ การลบไม่สามารถกู้คืนได้`)
    )
      return;

    const token = getToken();
    try {
      const res = await fetch(`/api/admin/teams/${team.id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
      const data = await res.json();
      if (!res.ok) {
        setPageError(data.error);
        return;
      }
      showSuccess(`✅ ลบทีม "${team.name}" สำเร็จ`);
      setTeams((prev) => prev.filter((t) => t.id !== team.id));
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    }
  };

  const currentSeason = seasons.find((s) => s.id === selectedSeason);
  const compType = currentSeason?.competition_type || 'league';
  const divisionRequired = compType === 'league';
  const divisionVisible = compType !== 'tournament';

  const isFormOpen = formMode !== 'closed';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">👥 Team Management</h1>
          <p className="text-gray-600 mt-1 text-sm">เพิ่ม แก้ไข และจัดการทีมแข่งขัน</p>
        </div>
        {selectedSeason && selectedAgeGroup && !isFormOpen && (
          <button
            onClick={openAddForm}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition"
          >
            ➕ เพิ่มทีม
          </button>
        )}
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {successMessage}
        </div>
      )}
      {pageError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start justify-between gap-2">
          <span>⚠️ {pageError}</span>
          <button
            onClick={() => setPageError(null)}
            className="text-red-400 hover:text-red-600 shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Season</label>
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
            disabled={isLoadingSeasons}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="">เลือก Season...</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Age Group</label>
          <select
            value={selectedAgeGroup}
            onChange={(e) => setSelectedAgeGroup(e.target.value)}
            disabled={isLoadingAgeGroups || !selectedSeason}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="">เลือก Age Group...</option>
            {ageGroups.map((ag) => (
              <option key={ag.id} value={ag.id}>{ag.code} — {ag.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Search + Filter bar */}
      {selectedSeason && selectedAgeGroup && (
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              type="text"
              placeholder="ค้นหาชื่อทีม / ชื่อย่อ"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterDivision}
            onChange={(e) => setFilterDivision(e.target.value)}
            disabled={isLoadingDivisions}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="">ทุกดิวิชั่น</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            แสดงที่ปิดการใช้งานด้วย
          </label>
          {isFormOpen && (
            <button
              onClick={openAddForm}
              className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition"
            >
              ➕ เพิ่ม
            </button>
          )}
        </div>
      )}

      {/* Main content */}
      {!selectedSeason || !selectedAgeGroup ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center text-blue-700">
          เลือก Season และ Age Group เพื่อดูข้อมูลทีม
        </div>
      ) : isLoadingTeams ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
          <span className="text-gray-600">กำลังโหลดข้อมูล...</span>
        </div>
      ) : (
        <div className={`grid gap-4 sm:gap-6 ${isFormOpen ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1'}`}>

          {/* Add/Edit Form */}
          {isFormOpen && (
            <div className="md:col-span-1 bg-white rounded-lg shadow p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800">
                  {formMode === 'add' ? '➕ เพิ่มทีม' : '✏️ แก้ไขทีม'}
                </h2>
                <button
                  onClick={closeForm}
                  className="text-gray-400 hover:text-gray-600 text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              {formError && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    ชื่อทีม <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleFormChange('name', e.target.value)}
                    placeholder="ชื่อทีมเต็ม"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ชื่อย่อ</label>
                  <input
                    type="text"
                    value={formData.short_name}
                    onChange={(e) => handleFormChange('short_name', e.target.value)}
                    placeholder="เช่น AFC (ไม่เกิน 6 ตัว)"
                    maxLength={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {divisionVisible ? (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      ดิวิชั่น {divisionRequired && <span className="text-red-500">*</span>}
                    </label>
                    <select
                      value={formData.division_id}
                      onChange={(e) => handleFormChange('division_id', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required={divisionRequired}
                    >
                      <option value="">{divisionRequired ? 'เลือกดิวิชั่น...' : '— ไม่ระบุ (ใช้กับ Tournament Groups) —'}</option>
                      {divisions.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    {compType === 'mixed' && (
                      <p className="text-xs text-amber-600 mt-1">
                        Mixed season เลือก Division ได้ หรือเว้นว่างเพื่อใช้กับ Tournament Groups
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                    🏆 Tournament season ไม่จำเป็นต้องเลือก Division — หลังเพิ่มทีมแล้วให้ไปจัดกลุ่มที่ Tournament Groups
                  </div>
                )}

                {/* Team Color */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">สีทีม</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formData.use_color}
                        onChange={(e) => handleFormChange('use_color', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <span className="text-gray-700">ตั้งสีทีม</span>
                    </label>
                    {formData.use_color && (
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={formData.team_color}
                          onChange={(e) => handleFormChange('team_color', e.target.value)}
                          className="w-10 h-10 rounded cursor-pointer border border-gray-300 p-0.5"
                        />
                        <span className="text-sm font-mono text-gray-600">{formData.team_color}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Logo URL */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">โลโก้ (URL)</label>
                  <input
                    type="url"
                    value={formData.logo_url}
                    onChange={(e) => handleFormChange('logo_url', e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {formData.logo_url && !logoPreviewError && (
                    <div className="mt-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={formData.logo_url}
                        alt="preview"
                        className="h-12 w-12 object-contain border rounded bg-gray-50"
                        onError={() => setLogoPreviewError(true)}
                      />
                    </div>
                  )}
                  {logoPreviewError && (
                    <p className="text-xs text-red-500 mt-1">ไม่สามารถโหลดรูปได้</p>
                  )}
                </div>

                {formMode === 'edit' && (
                  <div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formData.active}
                        onChange={(e) => handleFormChange('active', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <span className="font-semibold text-gray-700">ใช้งานอยู่ (Active)</span>
                    </label>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={formLoading}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-semibold text-sm transition"
                  >
                    {formLoading ? 'กำลังบันทึก...' : '💾 บันทึก'}
                  </button>
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={formLoading}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-semibold text-sm transition"
                  >
                    ยกเลิก
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Team List */}
          <div className={`${isFormOpen ? 'md:col-span-2' : 'col-span-1'} bg-white rounded-lg shadow overflow-hidden`}>
            {/* Summary */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap gap-4 text-sm">
              <span className="text-gray-700">
                แสดง <strong>{filteredTeams.length}</strong> / {teams.length} ทีม
              </span>
              <span className="text-green-700">🟢 ใช้งาน {activeCount} ทีม</span>
              {inactiveCount > 0 && (
                <span className="text-red-600">🔴 ปิดใช้งาน {inactiveCount} ทีม</span>
              )}
            </div>

            {filteredTeams.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                {searchQuery || filterDivision ? 'ไม่พบทีมที่ตรงกับการค้นหา' : 'ยังไม่มีข้อมูลทีม'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-800 text-white text-xs">
                      <th className="px-3 py-3 text-center w-8">#</th>
                      <th className="px-3 py-3 text-center w-10">🎨</th>
                      <th className="px-3 py-3 text-left">ชื่อทีม</th>
                      <th className="px-3 py-3 text-left hidden sm:table-cell">ชื่อย่อ</th>
                      <th className="px-3 py-3 text-left hidden md:table-cell">ดิวิชั่น</th>
                      <th className="px-3 py-3 text-center hidden sm:table-cell">ผู้เล่น</th>
                      <th className="px-3 py-3 text-center">สถานะ</th>
                      <th className="px-3 py-3 text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTeams.map((team, index) => (
                      <tr
                        key={team.id}
                        className={`border-b border-gray-100 transition hover:bg-gray-50 ${
                          !team.active ? 'opacity-60' : ''
                        } ${editingTeamId === team.id ? 'bg-blue-50' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}
                      >
                        <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{index + 1}</td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center">
                            <TeamColorBadge
                              color={team.team_color}
                              logoUrl={team.logo_url}
                              name={team.name}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-gray-800">{team.name}</td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs hidden sm:table-cell">
                          {team.short_name || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs hidden md:table-cell">
                          {team.division?.name ? (
                            team.division.name
                          ) : compType === 'league' ? (
                            '—'
                          ) : (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">Tournament</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-600 text-xs hidden sm:table-cell">
                          {team.player_count > 0 ? (
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-semibold">
                              {team.player_count} คน
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {team.active ? (
                            <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                              🟢 ใช้งาน
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-semibold">
                              🔴 ปิดใช้งาน
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openEditForm(team)}
                              title="แก้ไข"
                              className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleToggleActive(team)}
                              title={team.active ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}
                              className={`px-2 py-1 text-xs rounded transition ${
                                team.active
                                  ? 'bg-red-100 hover:bg-red-200 text-red-700'
                                  : 'bg-green-100 hover:bg-green-200 text-green-700'
                              }`}
                            >
                              {team.active ? '🔴' : '✅'}
                            </button>
                            {!team.active && (
                              <button
                                onClick={() => handleDelete(team)}
                                title="ลบออกจากระบบ"
                                className="px-2 py-1 text-xs bg-gray-100 hover:bg-red-100 text-gray-500 hover:text-red-600 rounded transition"
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

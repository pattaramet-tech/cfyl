'use client';

import { useCallback, useEffect, useState } from 'react';

interface Opt { id: string; name: string; code?: string }
interface SeasonOpt extends Opt { competition_type?: string }
interface Group { id: string; name: string; code: string | null; sort_order: number; team_count: number }
interface GroupTeam { id: string; team_id: string; sort_order: number; team: { id: string; name: string; short_name: string | null } }
interface StandRow { rank: number; teamName: string; played: number; wins: number; draws: number; losses: number; goalDiff: number; points: number }

const authHeader = (): Record<string, string> => {
  const t = localStorage.getItem('admin_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export default function TournamentGroupsPage() {
  const [seasons, setSeasons] = useState<SeasonOpt[]>([]);
  const [ageGroups, setAgeGroups] = useState<Opt[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [ageGroupId, setAgeGroupId] = useState('');
  const [competitionType, setCompetitionType] = useState<string>('league');

  const [groups, setGroups] = useState<Group[]>([]);
  const [teams, setTeams] = useState<Opt[]>([]); // all teams in season+age
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupTeams, setGroupTeams] = useState<GroupTeam[]>([]);
  const [standings, setStandings] = useState<{ name: string; rows: StandRow[] } | null>(null);

  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [addTeamId, setAddTeamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // seasons
  useEffect(() => {
    fetch('/api/public/seasons').then((r) => (r.ok ? r.json() : [])).then((l: SeasonOpt[]) => {
      setSeasons(l);
      if (l.length) setSeasonId(l[0].id);
    });
  }, []);

  // age groups + competition type on season change
  useEffect(() => {
    if (!seasonId) return;
    setAgeGroupId('');
    fetch(`/api/public/age-groups?seasonId=${seasonId}`).then((r) => (r.ok ? r.json() : [])).then((l: Opt[]) => {
      setAgeGroups(l);
      if (l.length) setAgeGroupId(l[0].id);
    });
    const sel = seasons.find((s) => s.id === seasonId);
    setCompetitionType(sel?.competition_type || 'league');
  }, [seasonId, seasons]);

  const loadGroups = useCallback(() => {
    if (!seasonId || !ageGroupId) return;
    fetch(`/api/admin/tournament-groups?seasonId=${seasonId}&ageGroupId=${ageGroupId}`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : []))
      .then((g: Group[]) => setGroups(g));
    fetch(`/api/public/teams?seasonId=${seasonId}&ageGroupId=${ageGroupId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((t: Opt[]) => setTeams(t));
  }, [seasonId, ageGroupId]);

  useEffect(() => {
    setSelectedGroup(null);
    setGroupTeams([]);
    setStandings(null);
    loadGroups();
  }, [loadGroups]);

  const loadGroupTeams = useCallback((gid: string) => {
    fetch(`/api/admin/tournament-groups/${gid}/teams`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : []))
      .then((t: GroupTeam[]) => setGroupTeams(t));
  }, []);

  const selectGroup = (gid: string) => {
    setSelectedGroup(gid);
    setStandings(null);
    setAddTeamId('');
    loadGroupTeams(gid);
  };

  const setCompType = async (val: string) => {
    setCompetitionType(val);
    await fetch(`/api/admin/seasons/${seasonId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ competition_type: val }),
    });
  };

  const createGroup = async () => {
    if (!newName.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/admin/tournament-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ seasonId, ageGroupId, name: newName.trim(), code: newCode.trim() || null, sort_order: groups.length }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'สร้างกลุ่มไม่สำเร็จ');
      setNewName(''); setNewCode('');
      loadGroups();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };

  const deleteGroup = async (g: Group) => {
    const force = g.team_count > 0;
    if (!confirm(force ? `กลุ่ม "${g.name}" มี ${g.team_count} ทีม — ยืนยันลบกลุ่ม (เอาทีมออกด้วย)?` : `ลบกลุ่ม "${g.name}"?`)) return;
    setError(null);
    const res = await fetch(`/api/admin/tournament-groups/${g.id}${force ? '?force=true' : ''}`, { method: 'DELETE', headers: authHeader() });
    if (!res.ok) { setError((await res.json()).error || 'ลบไม่สำเร็จ'); return; }
    if (selectedGroup === g.id) { setSelectedGroup(null); setGroupTeams([]); }
    loadGroups();
  };

  const addTeam = async () => {
    if (!addTeamId || !selectedGroup) return;
    setError(null);
    const res = await fetch(`/api/admin/tournament-groups/${selectedGroup}/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ teamId: addTeamId }),
    });
    if (!res.ok) { setError((await res.json()).error || 'เพิ่มทีมไม่สำเร็จ'); return; }
    setAddTeamId('');
    loadGroupTeams(selectedGroup);
    loadGroups();
  };

  const removeTeam = async (teamId: string) => {
    if (!selectedGroup) return;
    const res = await fetch(`/api/admin/tournament-groups/${selectedGroup}/teams/${teamId}`, { method: 'DELETE', headers: authHeader() });
    if (!res.ok) { setError((await res.json()).error || 'เอาทีมออกไม่สำเร็จ'); return; }
    loadGroupTeams(selectedGroup);
    loadGroups();
  };

  const showStandings = async (gid: string, name: string) => {
    const res = await fetch(`/api/admin/tournament-groups/${gid}/standings`, { headers: authHeader() });
    if (!res.ok) { setError((await res.json()).error || 'โหลด standings ไม่สำเร็จ'); return; }
    const data = await res.json();
    setStandings({ name, rows: data.standings });
  };

  const assignedInGroup = new Set(groupTeams.map((gt) => gt.team_id));
  const teamOptions = teams.filter((t) => !assignedInGroup.has(t.id));
  const selClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">🏆 Tournament Groups</h1>
        <p className="text-slate-600 mt-1 text-sm">จัดกลุ่มทัวร์นาเมนต์ (รอบแบ่งกลุ่ม) — ไม่กระทบโหมดลีกเดิม</p>
      </div>

      {/* Selectors */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Season</label>
          <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} className={selClass}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Age Group</label>
          <select value={ageGroupId} onChange={(e) => setAgeGroupId(e.target.value)} className={selClass}>
            {ageGroups.map((a) => <option key={a.id} value={a.id}>{a.code || a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Competition Type</label>
          <select value={competitionType} onChange={(e) => setCompType(e.target.value)} className={selClass}>
            <option value="league">league</option>
            <option value="tournament">tournament</option>
            <option value="mixed">mixed</option>
          </select>
        </div>
        {competitionType === 'league' && (
          <span className="text-xs text-amber-600">ℹ️ ซีซันนี้เป็นโหมด league — ตั้งเป็น tournament/mixed เพื่อใช้กลุ่ม</span>
        )}
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">❌ {error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Groups list */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <h2 className="font-bold text-slate-800 mb-3">กลุ่ม ({groups.length})</h2>
          <div className="flex gap-2 mb-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อกลุ่ม เช่น Group A" className={`${selClass} flex-1`} />
            <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="code (A)" className={`${selClass} w-24`} />
            <button onClick={createGroup} disabled={busy || !newName.trim()} className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-lg text-sm font-semibold">+ สร้าง</button>
          </div>
          {groups.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">ยังไม่มีกลุ่ม</p>
          ) : (
            <ul className="space-y-1">
              {groups.map((g) => (
                <li key={g.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${selectedGroup === g.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`}>
                  <button onClick={() => selectGroup(g.id)} className="flex-1 text-left">
                    <span className="font-semibold text-slate-800">{g.name}</span>
                    {g.code && <span className="text-xs text-slate-400 ml-2">[{g.code}]</span>}
                    <span className="text-xs text-slate-500 ml-2">· {g.team_count} ทีม</span>
                  </button>
                  <button onClick={() => showStandings(g.id, g.name)} className="text-xs text-blue-700 hover:underline">Standings</button>
                  <button onClick={() => deleteGroup(g)} className="text-xs text-red-600 hover:underline">ลบ</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Teams in selected group */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <h2 className="font-bold text-slate-800 mb-3">
            {selectedGroup ? `ทีมในกลุ่ม (${groupTeams.length})` : 'เลือกกลุ่มเพื่อจัดทีม'}
          </h2>
          {selectedGroup && (
            <>
              <div className="flex gap-2 mb-3">
                <select value={addTeamId} onChange={(e) => setAddTeamId(e.target.value)} className={`${selClass} flex-1`}>
                  <option value="">เลือกทีมที่จะเพิ่ม...</option>
                  {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button onClick={addTeam} disabled={!addTeamId} className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-green-300 text-white rounded-lg text-sm font-semibold">+ เพิ่ม</button>
              </div>
              {groupTeams.length === 0 ? (
                <p className="text-slate-400 text-sm py-6 text-center">ยังไม่มีทีมในกลุ่ม</p>
              ) : (
                <ul className="space-y-1">
                  {groupTeams.map((gt) => (
                    <li key={gt.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200">
                      <span className="text-slate-800">{gt.team?.name}</span>
                      <button onClick={() => removeTeam(gt.team_id)} className="text-xs text-red-600 hover:underline">เอาออก</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {/* Standings preview modal */}
      {standings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setStandings(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-slate-800">📊 Standings — {standings.name}</h3>
              <button onClick={() => setStandings(null)} className="text-slate-500 hover:text-slate-800">✕</button>
            </div>
            {standings.rows.length === 0 ? (
              <p className="text-slate-400 text-sm py-6 text-center">ยังไม่มีผลการแข่งขันในกลุ่มนี้</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-blue-900 text-white text-xs">
                      <th className="px-2 py-2">#</th><th className="px-2 py-2 text-left">ทีม</th>
                      <th className="px-2 py-2">แข่ง</th><th className="px-2 py-2">ช</th><th className="px-2 py-2">ส</th><th className="px-2 py-2">พ</th><th className="px-2 py-2">+/-</th><th className="px-2 py-2">คะแนน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.rows.map((r, i) => (
                      <tr key={r.teamName} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
                        <td className="px-2 py-2 text-center font-bold text-blue-900">{r.rank}</td>
                        <td className="px-2 py-2 font-semibold text-slate-800">{r.teamName}</td>
                        <td className="px-2 py-2 text-center">{r.played}</td>
                        <td className="px-2 py-2 text-center">{r.wins}</td>
                        <td className="px-2 py-2 text-center">{r.draws}</td>
                        <td className="px-2 py-2 text-center">{r.losses}</td>
                        <td className="px-2 py-2 text-center">{r.goalDiff > 0 ? '+' : ''}{r.goalDiff}</td>
                        <td className="px-2 py-2 text-center font-bold text-blue-900">{r.points}</td>
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

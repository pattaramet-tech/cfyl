'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { TeamLogo } from '@/components/TeamLogo';

interface Team {
  id: string;
  name: string;
  short_name?: string;
  logo_url?: string;
  season_id?: string;
  age_group_id?: string;
  division_id?: string;
  division?: { id: string; name: string };
  age_group?: { id: string; code: string; name: string };
  season?: { id: string; name: string; year: number };
}

export default function TeamsDirectoryPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('');

  useEffect(() => {
    const loadTeams = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/public/teams');
        if (!response.ok) throw new Error('Failed to fetch teams');
        const data = await response.json();
        setTeams(data);
        setError(null);
      } catch (err) {
        console.error('[TEAMS_DIRECTORY] Load error:', err);
        setError('ไม่สามารถโหลดข้อมูลทีมได้');
        setTeams([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadTeams();
  }, []);

  const ageGroups = useMemo(() => {
    const unique = new Map<string, { id: string; code: string; name: string }>();
    teams.forEach((team) => {
      if (team.age_group?.id) {
        unique.set(team.age_group.id, team.age_group);
      }
    });
    return Array.from(unique.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [teams]);

  const divisions = useMemo(() => {
    const unique = new Map<string, { id: string; name: string }>();
    teams.forEach((team) => {
      if (team.division?.id) {
        unique.set(team.division.id, team.division);
      }
    });
    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [teams]);

  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        !query ||
        team.name.toLowerCase().includes(query) ||
        (team.short_name?.toLowerCase().includes(query) ?? false) ||
        (team.age_group?.code.toLowerCase().includes(query) ?? false) ||
        (team.division?.name.toLowerCase().includes(query) ?? false);

      const matchesAgeGroup = !selectedAgeGroup || team.age_group?.id === selectedAgeGroup;
      const matchesDivision = !selectedDivision || team.division?.id === selectedDivision;

      return matchesSearch && matchesAgeGroup && matchesDivision;
    });
  }, [teams, searchQuery, selectedAgeGroup, selectedDivision]);


  if (isLoading) {
    return (
      <div className="cfyl-container py-6">
        <div className="h-96 bg-gray-200 animate-pulse rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="cfyl-container py-4 sm:py-6">
      {/* Back Link */}
      <Link href="/" className="inline-block text-blue-600 hover:underline mb-4 sm:mb-6">
        ← กลับหน้าหลัก
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">ทีมที่เข้าร่วมการแข่งขัน</h1>
        <p className="text-sm sm:text-base text-gray-600 mb-4">
          ค้นหาทีมของคุณ เพื่อดูโปรแกรมแข่งขัน ผลการแข่งขัน รายชื่อนักกีฬา ดาวซัลโว และข้อมูลวินัยของทีม
        </p>
        <p className="text-xs sm:text-sm text-gray-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          สำหรับเจ้าหน้าที่ทีม / โค้ช / ผู้ปกครอง: สามารถค้นหาทีมของคุณ แล้วกดดูข้อมูลทีม เพื่อดูโปรแกรมแข่งขัน ผลการแข่งขัน
          รายชื่อนักกีฬา ดาวซัลโว และใบเหลือง/ใบแดงของทีมได้
        </p>
      </div>

      {error && (
        <div className="cfyl-card bg-red-50 border border-red-200 text-red-700 p-4 mb-6 rounded">
          {error}
        </div>
      )}

      {/* Search Box */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="ค้นหาชื่อทีม..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">รุ่นอายุ</label>
          <select
            value={selectedAgeGroup}
            onChange={(e) => setSelectedAgeGroup(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="">ทุกรุ่นอายุ</option>
            {ageGroups.map((ag) => (
              <option key={ag.id} value={ag.id}>
                {ag.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">ดิวิชั่น</label>
          <select
            value={selectedDivision}
            onChange={(e) => setSelectedDivision(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="">ทุกดิวิชั่น</option>
            {divisions.map((div) => (
              <option key={div.id} value={div.id}>
                {div.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Teams Grid */}
      {filteredTeams.length === 0 ? (
        <div className="cfyl-card text-center py-12">
          <p className="text-lg text-gray-600 mb-2">
            {teams.length === 0 ? '❌ ยังไม่มีข้อมูลทีม' : '❌ ไม่พบทีมที่ตรงกับคำค้นหา'}
          </p>
          {teams.length > 0 && (
            <p className="text-sm text-gray-500">
              ลองเปลี่ยนคำค้นหาหรือเงื่อนไขการกรอง
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTeams.map((team) => (
            <Link
              key={team.id}
              href={`/teams/${team.id}`}
              className="cfyl-card p-4 hover:shadow-lg hover:scale-105 transition-all duration-200 flex flex-col"
            >
              {/* Logo Section */}
              <div className="flex items-center justify-between mb-3">
                <TeamLogo
                  logoUrl={team.logo_url}
                  name={team.name}
                  shortName={team.short_name}
                  size="md"
                />
                <div className="text-2xl">→</div>
              </div>

              {/* Team Info */}
              <div className="mb-3 flex-1">
                <h3 className="font-bold text-gray-900 text-sm sm:text-base break-words mb-1">{team.name}</h3>
                {team.short_name && <p className="text-xs text-gray-500 mb-2">{team.short_name}</p>}
                <div className="flex flex-wrap gap-2">
                  {team.age_group && (
                    <span className="cfyl-badge bg-blue-100 text-blue-700 px-2 py-1 text-xs rounded">
                      {team.age_group.name}
                    </span>
                  )}
                  {team.division && (
                    <span className="cfyl-badge bg-gray-100 text-gray-700 px-2 py-1 text-xs rounded">
                      {team.division.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Button */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-200 mt-3">
                <span className="text-xs text-gray-500">ดูข้อมูลทีม</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Summary */}
      {teams.length > 0 && filteredTeams.length > 0 && (
        <div className="text-center mt-6 text-sm text-gray-600">
          แสดง {filteredTeams.length} จากทั้งหมด {teams.length} ทีม
        </div>
      )}
    </div>
  );
}

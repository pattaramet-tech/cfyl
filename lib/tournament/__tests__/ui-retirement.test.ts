import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLegacyAdminRollbackLinks,
  buildPublicTournamentNavLinks,
  shouldShowTournamentV1Links,
} from '../ui-retirement';

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

function repoFileExists(...segments: string[]): boolean {
  return fs.existsSync(path.join(process.cwd(), ...segments));
}

describe('tournament UI retirement helpers', () => {
  it('hides legacy links by default', () => {
    expect(shouldShowTournamentV1Links({})).toBe(false);
    expect(buildPublicTournamentNavLinks(false)).toEqual([
      {
        href: '/tournament/schedule',
        label: 'ทัวร์นาเมนต์',
      },
    ]);
    expect(buildLegacyAdminRollbackLinks(false)).toEqual([]);
  });

  it('reveals legacy links when NEXT_PUBLIC_SHOW_TOURNAMENT_V1_LINKS is enabled', () => {
    expect(shouldShowTournamentV1Links({ NEXT_PUBLIC_SHOW_TOURNAMENT_V1_LINKS: 'true' })).toBe(
      true,
    );
    expect(shouldShowTournamentV1Links({ NEXT_PUBLIC_SHOW_TOURNAMENT_V1_LINKS: '1' })).toBe(true);
    expect(buildPublicTournamentNavLinks(true)).toEqual([
      {
        href: '/tournament/schedule',
        label: 'ทัวร์นาเมนต์',
      },
      {
        href: '/tournaments',
        label: 'Tournament V1',
        badge: 'Legacy',
      },
    ]);
    expect(buildLegacyAdminRollbackLinks(true).map((link) => link.href)).toEqual([
      '/admin/tournament-groups',
      '/admin/tournament-fixtures',
      '/admin/tournament-bracket',
    ]);
  });
});

describe('tournament UI retirement source wiring', () => {
  it('keeps Admin navigation focused on Tournament V2', () => {
    const source = readRepoFile('components', 'AdminNav.tsx');

    expect(source).toContain("/admin/tournament'");
    expect(source).toContain("/admin/tournament/setup'");
    expect(source).toContain("/admin/tournament/meeting-draw'");
    expect(source).toContain("/admin/tournament/schedule/import'");
    expect(source).not.toContain("/admin/tournament-groups'");
    expect(source).not.toContain("/admin/tournament-fixtures'");
    expect(source).not.toContain("/admin/tournament-bracket'");
  });

  it('uses the centralized public tournament nav helper', () => {
    const source = readRepoFile('components', 'PublicChrome.tsx');

    expect(source).toContain("buildPublicTournamentNavLinks");
    expect(source).not.toContain("{ href: '/tournaments', label: 'ทัวร์นาเมนต์' }");
  });

  it('adds the legacy notice text to shared Tournament V1 layouts', () => {
    const noticeSource = readRepoFile('components', 'tournament', 'TournamentLegacyNotice.tsx');
    const publicLayout = readRepoFile('app', 'tournaments', 'layout.tsx');
    const groupsLayout = readRepoFile('app', 'admin', 'tournament-groups', 'layout.tsx');
    const fixturesLayout = readRepoFile('app', 'admin', 'tournament-fixtures', 'layout.tsx');
    const bracketLayout = readRepoFile('app', 'admin', 'tournament-bracket', 'layout.tsx');

    expect(noticeSource).toContain('หน้านี้เป็นระบบ Tournament เดิม');
    expect(noticeSource).toContain('ระบบ Tournament V2 กำลังถูกนำมาใช้แทน');
    expect(noticeSource).toContain('หน้านี้ยังคงเปิดไว้สำหรับตรวจสอบและย้อนกลับชั่วคราว');
    expect(noticeSource).toContain('ไปที่ Tournament V2');

    expect(publicLayout).toContain('TournamentLegacyNotice');
    expect(publicLayout).toContain('/tournament/schedule');
    expect(groupsLayout).toContain('TournamentLegacyNotice');
    expect(fixturesLayout).toContain('TournamentLegacyNotice');
    expect(bracketLayout).toContain('TournamentLegacyNotice');
    expect(groupsLayout).toContain('/admin/tournament');
    expect(fixturesLayout).toContain('/admin/tournament');
    expect(bracketLayout).toContain('/admin/tournament');
  });

  it('preserves direct legacy routes and APIs for rollback', () => {
    expect(repoFileExists('app', 'tournaments', 'page.tsx')).toBe(true);
    expect(repoFileExists('app', 'tournaments', '[seasonSlug]', '[ageGroupCode]', 'page.tsx')).toBe(
      true,
    );
    expect(
      repoFileExists('app', 'tournaments', '[seasonSlug]', '[ageGroupCode]', 'groups', 'page.tsx'),
    ).toBe(true);
    expect(
      repoFileExists(
        'app',
        'tournaments',
        '[seasonSlug]',
        '[ageGroupCode]',
        'fixtures',
        'page.tsx',
      ),
    ).toBe(true);
    expect(
      repoFileExists(
        'app',
        'tournaments',
        '[seasonSlug]',
        '[ageGroupCode]',
        'bracket',
        'page.tsx',
      ),
    ).toBe(true);

    expect(repoFileExists('app', 'api', 'admin', 'tournament-groups', 'route.ts')).toBe(true);
    expect(repoFileExists('app', 'api', 'admin', 'tournament-fixtures', 'route.ts')).toBe(true);
    expect(repoFileExists('app', 'api', 'admin', 'tournament-bracket', 'route.ts')).toBe(true);
  });
});

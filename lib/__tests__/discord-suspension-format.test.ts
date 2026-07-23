import { describe, it, expect } from 'vitest';
import {
  formatThaiDateWithWeekday,
  formatDiscordTitle,
  formatSuspensionCause,
  formatOpponentLine,
  buildPlayerBlocks,
  groupSuspensionNotifications,
  type NotificationEntry,
  type SuspensionNotificationInput,
} from '../discord-suspension-format';
import { packMessages } from '../discord';

describe('formatThaiDateWithWeekday', () => {
  it('formats 2026-07-25 as วันเสาร์ที่ 25 ก.ค. 2569', () => {
    expect(formatThaiDateWithWeekday('2026-07-25')).toBe('วันเสาร์ที่ 25 ก.ค. 2569');
  });

  it('never shifts a day due to local timezone parsing', () => {
    // A naive `new Date('2026-07-25')` parsed in a timezone west of UTC could roll
    // back to Friday. Run across a spread of dates to guard against that class of bug.
    expect(formatThaiDateWithWeekday('2026-01-01')).toBe('วันพฤหัสบดีที่ 1 ม.ค. 2569');
    expect(formatThaiDateWithWeekday('2026-12-31')).toBe('วันพฤหัสบดีที่ 31 ธ.ค. 2569');
  });

  it('returns null when there is no date', () => {
    expect(formatThaiDateWithWeekday(null)).toBeNull();
    expect(formatThaiDateWithWeekday(undefined)).toBeNull();
    expect(formatThaiDateWithWeekday('')).toBeNull();
  });
});

describe('formatDiscordTitle — matchday parsing', () => {
  it('"MatchDay 11" displays as นัดที่ 11', () => {
    expect(formatDiscordTitle({ matchday: 'MatchDay 11', matchDate: null, seasonYear: 2026 })).toBe(
      '🚫 แจ้งโทษแบนนัดที่ 11'
    );
  });

  it('"MD11" displays as นัดที่ 11', () => {
    expect(formatDiscordTitle({ matchday: 'MD11', matchDate: null, seasonYear: 2026 })).toBe(
      '🚫 แจ้งโทษแบนนัดที่ 11'
    );
  });

  it('numeric 11 displays as นัดที่ 11', () => {
    expect(formatDiscordTitle({ matchday: 11, matchDate: null, seasonYear: 2026 })).toBe(
      '🚫 แจ้งโทษแบนนัดที่ 11'
    );
  });

  it('combines matchday + date when both are present', () => {
    expect(
      formatDiscordTitle({ matchday: 11, matchDate: '2026-07-25', seasonYear: 2026 })
    ).toBe('🚫 แจ้งโทษแบนนัดที่ 11 วันเสาร์ที่ 25 ก.ค. 2569');
  });

  it('shows date-only title when matchday is missing', () => {
    expect(formatDiscordTitle({ matchday: null, matchDate: '2026-07-25', seasonYear: 2026 })).toBe(
      '🚫 แจ้งโทษแบน วันเสาร์ที่ 25 ก.ค. 2569'
    );
  });

  it('falls back to "CFYL {year}" when neither matchday nor date is available', () => {
    expect(formatDiscordTitle({ matchday: null, matchDate: null, seasonYear: 2026 })).toBe(
      '🚫 แจ้งโทษแบน CFYL 2026'
    );
  });
});

describe('formatSuspensionCause', () => {
  it('accumulated_points at 6 points shows 3 ใบเหลือง', () => {
    expect(
      formatSuspensionCause({ suspension_type: 'accumulated_points', accumulated_threshold: 6 })
    ).toBe('คะแนนครบเกณฑ์ 6 คะแนน (3 ใบเหลือง)');
  });

  it('accumulated_points at 12 points shows 6 ใบเหลือง', () => {
    expect(
      formatSuspensionCause({ suspension_type: 'accumulated_points', accumulated_threshold: 12 })
    ).toBe('คะแนนครบเกณฑ์ 12 คะแนน (6 ใบเหลือง)');
  });

  it('accumulated_points at 18 and 24 points', () => {
    expect(
      formatSuspensionCause({ suspension_type: 'accumulated_points', accumulated_threshold: 18 })
    ).toBe('คะแนนครบเกณฑ์ 18 คะแนน (9 ใบเหลือง)');
    expect(
      formatSuspensionCause({ suspension_type: 'accumulated_points', accumulated_threshold: 24 })
    ).toBe('คะแนนครบเกณฑ์ 24 คะแนน (12 ใบเหลือง)');
  });

  it('falls back through suspension_details.threshold_crossed then total_points when accumulated_threshold is missing', () => {
    expect(
      formatSuspensionCause({
        suspension_type: 'accumulated_points',
        suspension_details: { threshold_crossed: 12 },
      })
    ).toBe('คะแนนครบเกณฑ์ 12 คะแนน (6 ใบเหลือง)');
    expect(
      formatSuspensionCause({ suspension_type: 'accumulated_points', total_points: 6 })
    ).toBe('คะแนนครบเกณฑ์ 6 คะแนน (3 ใบเหลือง)');
  });

  it('direct_red shows ใบแดงตรง', () => {
    expect(formatSuspensionCause({ suspension_type: 'direct_red' })).toBe('ใบแดงตรง');
  });

  it('second_yellow shows ใบเหลืองที่สอง', () => {
    expect(formatSuspensionCause({ suspension_type: 'second_yellow' })).toBe('ใบเหลืองที่สอง');
  });

  it('yellow_red shows ใบเหลือง + ใบแดง', () => {
    expect(formatSuspensionCause({ suspension_type: 'yellow_red' })).toBe('ใบเหลือง + ใบแดง');
  });

  it('never concatenates multiple cause types together', () => {
    const result = formatSuspensionCause({ suspension_type: 'direct_red', accumulated_threshold: 6 });
    expect(result).toBe('ใบแดงตรง');
    expect(result).not.toContain('คะแนนครบเกณฑ์');
  });

  it('manual/legacy falls back to trigger_event, then suspension_reason, then a generic label', () => {
    expect(
      formatSuspensionCause({
        suspension_type: 'manual',
        suspension_details: { trigger_event: 'ผู้ตัดสินรายงานพิเศษ' },
        suspension_reason: 'ควรไม่ถูกใช้',
      })
    ).toBe('ผู้ตัดสินรายงานพิเศษ');
    expect(
      formatSuspensionCause({ suspension_type: 'legacy', suspension_reason: 'เหตุผลเก่า' })
    ).toBe('เหตุผลเก่า');
    expect(formatSuspensionCause({ suspension_type: null })).toBe('ไม่ระบุสาเหตุ');
  });
});

describe('formatOpponentLine', () => {
  it('strips seconds from match_time (13:00:00 -> 13:00)', () => {
    expect(formatOpponentLine({ match_time: '13:00:00', opponent_name: 'รร.พลูตาหลวงวิทยา' })).toBe(
      'คู่แข่งขัน: เวลา 13:00 | พบ รร.พลูตาหลวงวิทยา'
    );
  });

  it('shows เวลาไม่ระบุ when match_time is missing', () => {
    expect(formatOpponentLine({ match_time: null, opponent_name: 'ทีม B' })).toBe(
      'คู่แข่งขัน: เวลาไม่ระบุ | พบ ทีม B'
    );
  });

  it('shows ไม่ทราบทีม when opponent_name is missing', () => {
    expect(formatOpponentLine({ match_time: '13:00:00', opponent_name: null })).toBe(
      'คู่แข่งขัน: เวลา 13:00 | พบ ไม่ทราบทีม'
    );
  });

  it('shows "ไม่พบโปรแกรมนัดถัดไป" when there is no next match at all', () => {
    expect(formatOpponentLine(null)).toBe('คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป');
    expect(formatOpponentLine(undefined)).toBe('คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป');
  });
});

describe('buildPlayerBlocks — grouping and legacy-text removal', () => {
  it('renders the exact single-player message from the spec, with no leading spaces on ทีม/สาเหตุ/คู่แข่งขัน', () => {
    const title = formatDiscordTitle({ matchday: 11, matchDate: '2026-07-25', seasonYear: 2026 });
    const entries: NotificationEntry[] = [
      {
        ageCode: 'U14',
        fullName: 'จีรยุทธ์ ชูวงค์',
        shirtNo: 7,
        teamName: 'รร.สวนป่าเขาชะอางค์',
        cause: formatSuspensionCause({ suspension_type: 'accumulated_points', accumulated_threshold: 6 }),
        opponentLine: formatOpponentLine({ match_time: '13:00:00', opponent_name: 'รร.พลูตาหลวงวิทยา' }),
      },
    ];
    const blocks = buildPlayerBlocks(entries);
    const [message] = packMessages(title, blocks, 8);

    expect(message).toBe(
      [
        '🚫 แจ้งโทษแบนนัดที่ 11 วันเสาร์ที่ 25 ก.ค. 2569',
        '',
        'รุ่น: U14',
        '1. จีรยุทธ์ ชูวงค์ #7',
        'ทีม: รร.สวนป่าเขาชะอางค์',
        'สาเหตุ: คะแนนครบเกณฑ์ 6 คะแนน (3 ใบเหลือง)',
        'คู่แข่งขัน: เวลา 13:00 | พบ รร.พลูตาหลวงวิทยา',
      ].join('\n')
    );
  });

  it('omits the shirt number entirely when the player has none', () => {
    const blocks = buildPlayerBlocks([
      {
        ageCode: 'U14',
        fullName: 'จีรยุทธ์ ชูวงค์',
        shirtNo: null,
        teamName: 'ทีม A',
        cause: 'ใบแดงตรง',
        opponentLine: 'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป',
      },
    ]);
    expect(blocks[0].split('\n')).toContain('1. จีรยุทธ์ ชูวงค์');
    expect(blocks[0]).not.toContain('#');
  });

  it('shows รุ่น only once per age-group run, and a blank line between players but not before ทีม', () => {
    const blocks = buildPlayerBlocks([
      {
        ageCode: 'U14',
        fullName: 'ผู้เล่นคนแรก',
        shirtNo: 7,
        teamName: 'ทีม A',
        cause: 'คะแนนครบเกณฑ์ 6 คะแนน (3 ใบเหลือง)',
        opponentLine: 'คู่แข่งขัน: เวลา 13:00 | พบ ทีม B',
      },
      {
        ageCode: 'U14',
        fullName: 'ผู้เล่นคนที่สอง',
        shirtNo: 10,
        teamName: 'ทีม C',
        cause: 'ใบแดงตรง',
        opponentLine: 'คู่แข่งขัน: เวลา 15:00 | พบ ทีม D',
      },
    ]);
    const [message] = packMessages('🚫 แจ้งโทษแบนนัดที่ 11 วันเสาร์ที่ 25 ก.ค. 2569', blocks, 8);

    expect(message).toBe(
      [
        '🚫 แจ้งโทษแบนนัดที่ 11 วันเสาร์ที่ 25 ก.ค. 2569',
        '',
        'รุ่น: U14',
        '1. ผู้เล่นคนแรก #7',
        'ทีม: ทีม A',
        'สาเหตุ: คะแนนครบเกณฑ์ 6 คะแนน (3 ใบเหลือง)',
        'คู่แข่งขัน: เวลา 13:00 | พบ ทีม B',
        '',
        '2. ผู้เล่นคนที่สอง #10',
        'ทีม: ทีม C',
        'สาเหตุ: ใบแดงตรง',
        'คู่แข่งขัน: เวลา 15:00 | พบ ทีม D',
      ].join('\n')
    );
  });

  it('re-emits รุ่น when the age group changes mid-message', () => {
    const blocks = buildPlayerBlocks([
      { ageCode: 'U14', fullName: 'A', shirtNo: null, teamName: 'ทีม A', cause: 'ใบแดงตรง', opponentLine: 'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป' },
      { ageCode: 'U16', fullName: 'B', shirtNo: null, teamName: 'ทีม B', cause: 'ใบแดงตรง', opponentLine: 'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป' },
    ]);
    expect(blocks[0].startsWith('รุ่น: U14\n')).toBe(true);
    expect(blocks[1].startsWith('รุ่น: U16\n')).toBe(true);
  });

  it('restarts player numbering at 1 for every new age group, never continuing the previous group\'s count', () => {
    const blocks = buildPlayerBlocks([
      { ageCode: 'U14', fullName: 'ผู้เล่น U14 คนแรก', shirtNo: null, teamName: 'ทีม A', cause: 'ใบแดงตรง', opponentLine: 'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป' },
      { ageCode: 'U14', fullName: 'ผู้เล่น U14 คนที่สอง', shirtNo: null, teamName: 'ทีม B', cause: 'ใบแดงตรง', opponentLine: 'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป' },
      { ageCode: 'U16', fullName: 'ผู้เล่น U16 คนแรก', shirtNo: null, teamName: 'ทีม C', cause: 'ใบแดงตรง', opponentLine: 'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป' },
    ]);
    const [message] = packMessages('🚫 แจ้งโทษแบนนัดที่ 11', blocks, 8);

    expect(message).toBe(
      [
        '🚫 แจ้งโทษแบนนัดที่ 11',
        '',
        'รุ่น: U14',
        '1. ผู้เล่น U14 คนแรก',
        'ทีม: ทีม A',
        'สาเหตุ: ใบแดงตรง',
        'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป',
        '',
        '2. ผู้เล่น U14 คนที่สอง',
        'ทีม: ทีม B',
        'สาเหตุ: ใบแดงตรง',
        'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป',
        '',
        'รุ่น: U16',
        '1. ผู้เล่น U16 คนแรก',
        'ทีม: ทีม C',
        'สาเหตุ: ใบแดงตรง',
        'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป',
      ].join('\n')
    );
    // The banned shape from the spec: a third age group's first player must never
    // continue as "3." — it must read "1." like every other group's first player.
    expect(message).not.toContain('3. ผู้เล่น U16 คนแรก');
  });

  it('keeps each player bound to their own opponent — same matchday/date, different teams', () => {
    // Two players in the same age group and same fixture date, but playing different
    // opponents at different times. A shared/borrowed match object would make one of
    // these wrong.
    const blocks = buildPlayerBlocks([
      {
        ageCode: 'U14',
        fullName: 'ผู้เล่น A',
        shirtNo: 1,
        teamName: 'ทีม A',
        cause: 'ใบแดงตรง',
        opponentLine: formatOpponentLine({ match_time: '09:00:00', opponent_name: 'ทีม X' }),
      },
      {
        ageCode: 'U14',
        fullName: 'ผู้เล่น B',
        shirtNo: 2,
        teamName: 'ทีม B',
        cause: 'ใบเหลืองที่สอง',
        opponentLine: formatOpponentLine({ match_time: '11:00:00', opponent_name: 'ทีม Y' }),
      },
    ]);
    expect(blocks[0]).toContain('คู่แข่งขัน: เวลา 09:00 | พบ ทีม X');
    expect(blocks[0]).not.toContain('ทีม Y');
    expect(blocks[1]).toContain('คู่แข่งขัน: เวลา 11:00 | พบ ทีม Y');
    expect(blocks[1]).not.toContain('ทีม X');
  });

  it('never re-introduces retired text like สถานะ:, เหตุการณ์:, คะแนนวินัย:, โทษแบน:, นัดที่โดนแบน:, วันที่:, MatchDay, Match Code, (เหย้า), (เยือน)', () => {
    const title = formatDiscordTitle({ matchday: 11, matchDate: '2026-07-25', seasonYear: 2026 });
    const blocks = buildPlayerBlocks([
      {
        ageCode: 'U14',
        fullName: 'จีรยุทธ์ ชูวงค์',
        shirtNo: 7,
        teamName: 'รร.สวนป่าเขาชะอางค์',
        cause: formatSuspensionCause({ suspension_type: 'accumulated_points', accumulated_threshold: 6 }),
        opponentLine: formatOpponentLine({ match_time: '13:00:00', opponent_name: 'รร.พลูตาหลวงวิทยา' }),
      },
    ]);
    const [message] = packMessages(title, blocks, 8);

    for (const banned of [
      'สถานะ:',
      'เหตุการณ์:',
      'คะแนนวินัย:',
      'โทษแบน:',
      'นัดที่โดนแบน:',
      'วันที่:',
      'MatchDay',
      'Match Code',
      '(เหย้า)',
      '(เยือน)',
    ]) {
      expect(message).not.toContain(banned);
    }
  });

  it('fallback title has no matchday/date and is not confused with the CFYL-year fallback', () => {
    const title = formatDiscordTitle({ matchday: null, matchDate: null, seasonYear: 2026 });
    expect(title).toBe('🚫 แจ้งโทษแบน CFYL 2026');
    expect(title).not.toContain('นัดที่');
  });
});

describe('groupSuspensionNotifications — fixture grouping and no-match isolation', () => {
  const withFixture: SuspensionNotificationInput = {
    ageCode: 'U14',
    fullName: 'ผู้เล่นมีโปรแกรม',
    shirtNo: 7,
    teamName: 'ทีม A',
    cause: 'ใบแดงตรง',
    match: { matchday: 11, match_date: '2026-07-25', match_time: '13:00:00', opponent_name: 'ทีม B' },
  };
  const withoutFixture: SuspensionNotificationInput = {
    ageCode: 'U14',
    fullName: 'ผู้เล่นไม่มีโปรแกรม',
    shirtNo: 9,
    teamName: 'ทีม C',
    cause: 'คะแนนครบเกณฑ์ 6 คะแนน (3 ใบเหลือง)',
    match: null,
  };

  it('puts the matchday-11 player in a group titled with นัดที่ 11', () => {
    const groups = groupSuspensionNotifications([withFixture], 2026);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('🚫 แจ้งโทษแบนนัดที่ 11 วันเสาร์ที่ 25 ก.ค. 2569');
    expect(groups[0].blocks.join('\n')).toContain('คู่แข่งขัน: เวลา 13:00 | พบ ทีม B');
  });

  it('puts the no-match player in its own CFYL {year} fallback group', () => {
    const groups = groupSuspensionNotifications([withoutFixture], 2026);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('🚫 แจ้งโทษแบน CFYL 2026');
    expect(groups[0].blocks.join('\n')).toContain('คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป');
  });

  it('never merges the matchday-11 player and the no-match player into the same group/message', () => {
    const groups = groupSuspensionNotifications([withFixture, withoutFixture], 2026);

    expect(groups).toHaveLength(2);
    const matchdayGroup = groups.find((g) => g.title.includes('นัดที่ 11'));
    const fallbackGroup = groups.find((g) => g.title === '🚫 แจ้งโทษแบน CFYL 2026');
    expect(matchdayGroup).toBeDefined();
    expect(fallbackGroup).toBeDefined();

    // Each group's blocks contain only the player that belongs to it.
    const matchdayText = matchdayGroup!.blocks.join('\n');
    const fallbackText = fallbackGroup!.blocks.join('\n');
    expect(matchdayText).toContain('ผู้เล่นมีโปรแกรม');
    expect(matchdayText).not.toContain('ผู้เล่นไม่มีโปรแกรม');
    expect(fallbackText).toContain('ผู้เล่นไม่มีโปรแกรม');
    expect(fallbackText).not.toContain('ผู้เล่นมีโปรแกรม');

    // The no-match player's line never carries a matchday/date title.
    expect(fallbackGroup!.title).not.toContain('นัดที่');
    expect(fallbackGroup!.title).not.toContain('วันเสาร์');
  });

  it('keeps each player bound to their own opponent when two teams share the same matchday+date', () => {
    const teamAPlayer: SuspensionNotificationInput = {
      ageCode: 'U14',
      fullName: 'ผู้เล่นทีม A',
      shirtNo: 1,
      teamName: 'ทีม A',
      cause: 'ใบแดงตรง',
      match: { matchday: 11, match_date: '2026-07-25', match_time: '09:00:00', opponent_name: 'ทีม X' },
    };
    const teamBPlayer: SuspensionNotificationInput = {
      ageCode: 'U14',
      fullName: 'ผู้เล่นทีม B',
      shirtNo: 2,
      teamName: 'ทีม B',
      cause: 'ใบเหลืองที่สอง',
      match: { matchday: 11, match_date: '2026-07-25', match_time: '11:00:00', opponent_name: 'ทีม Y' },
    };

    const groups = groupSuspensionNotifications([teamAPlayer, teamBPlayer], 2026);
    expect(groups).toHaveLength(1);
    const [block1, block2] = groups[0].blocks;
    expect(block1).toContain('คู่แข่งขัน: เวลา 09:00 | พบ ทีม X');
    expect(block1).not.toContain('ทีม Y');
    expect(block2).toContain('คู่แข่งขัน: เวลา 11:00 | พบ ทีม Y');
    expect(block2).not.toContain('ทีม X');
  });

  it('keeps players with two different banned matchdays in two separate groups, not merged', () => {
    const player = 'ผู้เล่นโดนแบนสองนัด';
    const firstBan: SuspensionNotificationInput = {
      ageCode: 'U14',
      fullName: player,
      shirtNo: 5,
      teamName: 'ทีม A',
      cause: 'คะแนนครบเกณฑ์ 12 คะแนน (6 ใบเหลือง)',
      match: { matchday: 11, match_date: '2026-07-25', match_time: '13:00:00', opponent_name: 'ทีม B' },
    };
    const secondBan: SuspensionNotificationInput = {
      ...firstBan,
      match: { matchday: 12, match_date: '2026-08-01', match_time: '15:00:00', opponent_name: 'ทีม D' },
    };

    const groups = groupSuspensionNotifications([firstBan, secondBan], 2026);
    expect(groups).toHaveLength(2);
    expect(groups[0].title).toContain('นัดที่ 11');
    expect(groups[1].title).toContain('นัดที่ 12');
    expect(groups[0].blocks.join('\n')).toContain('พบ ทีม B');
    expect(groups[1].blocks.join('\n')).toContain('พบ ทีม D');
  });
});

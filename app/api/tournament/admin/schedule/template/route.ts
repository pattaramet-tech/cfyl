import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireTournamentSuperAdmin } from '@/lib/tournament/services/auth';
import {
  SCHEDULE_TEMPLATE_HEADERS,
  SCHEDULE_TEMPLATE_SAMPLE,
} from '@/lib/tournament/scheduling/scheduleExcelTemplate';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireTournamentSuperAdmin(request);
  if (!auth.authenticated || !auth.authorized) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 });
  }

  const rows: Array<Array<string | number>> = [
    [...SCHEDULE_TEMPLATE_HEADERS],
    ...SCHEDULE_TEMPLATE_SAMPLE.map((sample) =>
      SCHEDULE_TEMPLATE_HEADERS.map((header) => sample[header] ?? '')
    ),
  ];

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = SCHEDULE_TEMPLATE_HEADERS.map((header) => ({
    wch: Math.max(header.length + 2, 14),
  }));
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Tournament_V2_Schedule');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="tournament_v2_schedule_template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}

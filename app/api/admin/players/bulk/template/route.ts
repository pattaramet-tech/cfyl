import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { PLAYER_HEADERS, PLAYER_SAMPLE } from '@/lib/bulk-import';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });

  const aoa: (string | number)[][] = [
    [...PLAYER_HEADERS],
    ...PLAYER_SAMPLE.map((r) => PLAYER_HEADERS.map((h) => r[h] ?? '')),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Players');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="players_template.xlsx"',
    },
  });
}

import Link from 'next/link';

interface TournamentLegacyNoticeProps {
  actionHref: string;
  actionLabel?: string;
  className?: string;
}

export function TournamentLegacyNotice({
  actionHref,
  actionLabel = 'ไปที่ Tournament V2',
  className = '',
}: TournamentLegacyNoticeProps) {
  return (
    <section
      className={`rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 ${className}`.trim()}
      aria-label="Tournament legacy notice"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="font-semibold">หน้านี้เป็นระบบ Tournament เดิม</p>
          <p>ระบบ Tournament V2 กำลังถูกนำมาใช้แทน</p>
          <p>หน้านี้ยังคงเปิดไว้สำหรับตรวจสอบและย้อนกลับชั่วคราว</p>
        </div>
        <Link
          href={actionHref}
          className="inline-flex items-center justify-center rounded-lg bg-amber-900 px-4 py-2 font-semibold text-white hover:bg-amber-950"
        >
          {actionLabel}
        </Link>
      </div>
    </section>
  );
}

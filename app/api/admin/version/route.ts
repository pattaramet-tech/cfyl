import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const commitSha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    null;

  const commitRef =
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ||
    null;

  const commitMessage =
    process.env.VERCEL_GIT_COMMIT_MESSAGE ||
    null;

  const shortSha = commitSha ? commitSha.slice(0, 7) : null;

  return NextResponse.json({
    app: 'CFYL Admin',
    version: shortSha || process.env.NEXT_PUBLIC_APP_VERSION || 'local',
    commitSha,
    shortSha,
    commitRef,
    commitMessage,
    vercelEnv: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
    expectedFixCommit: '9b0a1db',
    features: {
      byeResultPersistence: true,
      byeScoreTwoNil: true,
      byePublicBadges: true,
      standingsActiveFilter: true,
    },
  });
}

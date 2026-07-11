import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Regression guard for the 70e89f9 hotfix: lib/suspension-calc.ts creates a
// Supabase client (using SUPABASE_SERVICE_ROLE_KEY) at module-evaluation time
// and throws if env vars are missing. Importing ANY runtime value from it in a
// 'use client' component pulls that throw into the browser bundle, where the
// service-role key is never defined, crashing the page. lib/suspension-shared.ts
// must stay pure forever — these tests enforce that contract at the source level,
// not just behaviourally.
// ---------------------------------------------------------------------------

/** Strip comments so the source-contract checks only inspect executable code —
 *  documentation is free to name the forbidden patterns it's warning against. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('suspension-shared — client-safe module contract', () => {
  const sourcePath = path.resolve(__dirname, '../suspension-shared.ts');
  const rawSource = fs.readFileSync(sourcePath, 'utf-8');
  const source = stripComments(rawSource);

  it('never creates a Supabase client', () => {
    expect(source).not.toMatch(/createClient/);
    expect(source).not.toMatch(/@supabase\/supabase-js/);
  });

  it('never reads process.env', () => {
    expect(source).not.toMatch(/process\.env/);
  });

  it('never references the service-role key', () => {
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('imports no Node-only modules', () => {
    expect(source).not.toMatch(/from\s+['"](fs|path|crypto|child_process|os)['"]/);
  });

  it('can be imported with zero Supabase environment variables set — never throws', async () => {
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const savedAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const savedService = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    vi.resetModules();
    try {
      const mod = await import('../suspension-shared');
      expect(mod.calculateBanMatches(6)).toBe(1);
      expect(mod.getCurrentDisciplinaryPoints({ total_points: 6, point_sources: [] })).toBe(6);
    } finally {
      if (savedUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
      if (savedAnon !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedAnon;
      if (savedService !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedService;
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// Repo-wide guard: no 'use client' file may runtime-import from
// '@/lib/suspension-calc' (type-only imports are erased at compile time and
// remain safe). This is the exact class of bug that broke /admin/suspensions.
// ---------------------------------------------------------------------------

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    if (['node_modules', '.next', '.git'].includes(entry)) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (/\.(tsx|ts)$/.test(entry)) files.push(full);
  }
  return files;
}

describe('client components must not runtime-import @/lib/suspension-calc', () => {
  it('every "use client" file with a suspension-calc import uses `import type` only', () => {
    const root = path.resolve(__dirname, '../../');
    const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components'))];
    const offenders: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const firstLines = content.split('\n').slice(0, 3).join('\n');
      const isClientComponent = /^\s*['"]use client['"]\s*;?\s*$/m.test(firstLines);
      if (!isClientComponent) continue;

      for (const line of content.split('\n')) {
        if (!line.includes('@/lib/suspension-calc')) continue;
        if (!line.includes('import')) continue;
        const isTypeOnly = /^\s*import\s+type\s/.test(line);
        if (!isTypeOnly) offenders.push(`${path.relative(root, file)}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

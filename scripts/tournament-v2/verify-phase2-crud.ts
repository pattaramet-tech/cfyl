import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

console.log('[VERIFY_P2] Phase 2 CRUD verification is a manual integration test.');
console.log('[VERIFY_P2] Run after bootstrap and seed, using your admin token from localStorage.');
console.log('[VERIFY_P2] Endpoints to test:');
console.log('[VERIFY_P2]   GET/POST   /api/tournament/admin/tournaments');
console.log('[VERIFY_P2]   GET/PUT/DELETE /api/tournament/admin/tournaments/[id]');
console.log('[VERIFY_P2]   GET/POST   /api/tournament/admin/categories?tournament_id=...');
console.log('[VERIFY_P2]   GET/POST   /api/tournament/admin/venues?tournament_id=...');
console.log('[VERIFY_P2]   GET/POST   /api/tournament/admin/courts?venue_id=...');
console.log('[VERIFY_P2]   GET/POST/PUT/DELETE /api/tournament/admin/category-venues');
console.log('[VERIFY_P2]');
console.log('[VERIFY_P2] For programmatic verification, see unit tests in:');
console.log('[VERIFY_P2]   lib/tournament/services/__tests__/');
console.log('[VERIFY_P2]');
console.log('[VERIFY_P2] Run: npm run test');

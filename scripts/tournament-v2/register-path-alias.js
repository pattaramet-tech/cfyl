'use strict';
// Zero-dependency `@/*` -> repo-root require() alias for ts-node CLI scripts.
// Next.js/webpack resolve `@/*` (tsconfig.json paths) at build time; ts-node's
// CommonJS require() knows nothing about tsconfig `paths` without the
// `tsconfig-paths` package (not a project dependency — see AGENTS.md "no new
// packages"). Preloaded via `ts-node -r` so it patches Module._resolveFilename
// before any project file is required, letting verifier scripts import the
// real service modules (e.g. lib/tournament/services/*) that use `@/` imports
// internally, unmodified.
// CommonJS preload script for `ts-node -r`; Module patching requires require('module').
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(request, ...rest) {
  const resolvedRequest = request.startsWith('@/') ? path.join(projectRoot, request.slice(2)) : request;
  return originalResolveFilename.call(this, resolvedRequest, ...rest);
};

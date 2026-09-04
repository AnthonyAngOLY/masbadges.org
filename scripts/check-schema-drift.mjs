#!/usr/bin/env node
// check-schema-drift.mjs — find database objects the app depends on that no
// migration in this repo creates.
//
// WHY. `supabase/migrations/` is applied by hand in the Supabase SQL editor,
// and schema has repeatedly been created or edited there and never written back
// to git. That leaves the folder unable to rebuild the database, and leaves
// anyone reading it with a false picture of what is live. This script makes the
// gap visible and countable instead of something you rediscover mid-task.
//
// WHAT IT DOES. Scrapes `src/` for every `supabase.rpc('name')` and
// `supabase.from('relation')` the frontend calls, scrapes `supabase/migrations/`
// for every object those files create, and prints what the app calls but the
// repo never creates.
//
// WHAT IT CANNOT DO. It never touches the live database, so it misses three
// kinds of drift:
//   1. Tables reached only from inside an RPC body. Nothing in `src/` says
//      `.from('centre_invoices')`, so this scan cannot see that the table has no
//      migration — only the untracked RPCs that read it show up.
//   2. Objects that exist live and are called by nothing.
//   3. A function whose deployed body has drifted from its committed file.
//      `list_billing_invoices` and `list_my_invoices` are both in that state —
//      deployed returning columns their migration files do not declare — so
//      neither appears below.
// For all three, dump the live definitions:
//   supabase/diagnostics/dump_live_schema.sql
//
// USAGE
//   node scripts/check-schema-drift.mjs          # human-readable report
//   node scripts/check-schema-drift.mjs --json   # machine-readable
//   node scripts/check-schema-drift.mjs --strict # exit 1 if anything is missing
//
// Not wired into `npm run build` on purpose: drift is a standing condition to
// work down, not a reason to fail a deploy.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

// Objects Supabase/PostgREST provides that no migration of ours should create.
const BUILT_INS = new Set(['pg_stat_statements']);

function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.includes(extname(entry))) out.push(full);
  }
  return out;
}

function matchAll(text, re) {
  return [...text.matchAll(re)].map((m) => m[1].toLowerCase());
}

// --- what the frontend calls -------------------------------------------------

const srcFiles = walk(SRC, ['.ts', '.tsx']);
const calledRpcs = new Map();      // name -> Set of files
const calledRelations = new Map();

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(ROOT.length + 1);
  for (const name of matchAll(text, /\.rpc\(\s*'([a-z0-9_]+)'/g)) {
    if (!calledRpcs.has(name)) calledRpcs.set(name, new Set());
    calledRpcs.get(name).add(rel);
  }
  for (const name of matchAll(text, /\.from\(\s*'([a-z0-9_]+)'/g)) {
    if (!calledRelations.has(name)) calledRelations.set(name, new Set());
    calledRelations.get(name).add(rel);
  }
}

// --- what the migrations create ----------------------------------------------

const createdFunctions = new Set();
const createdRelations = new Set();

for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  for (const name of matchAll(
    sql,
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)/gi,
  )) createdFunctions.add(name);
  for (const name of matchAll(
    sql,
    /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?(?:view|table)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi,
  )) createdRelations.add(name);
}

// --- the gap -----------------------------------------------------------------

const missingRpcs = [...calledRpcs.keys()]
  .filter((n) => !createdFunctions.has(n) && !BUILT_INS.has(n))
  .sort();
const missingRelations = [...calledRelations.keys()]
  .filter((n) => !createdRelations.has(n) && !BUILT_INS.has(n))
  .sort();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    scanned: {
      sourceFiles: srcFiles.length,
      migrationFiles: readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).length,
      rpcsCalled: calledRpcs.size,
      relationsRead: calledRelations.size,
    },
    missingRpcs: missingRpcs.map((n) => ({ name: n, calledFrom: [...calledRpcs.get(n)].sort() })),
    missingRelations: missingRelations.map((n) => ({ name: n, calledFrom: [...calledRelations.get(n)].sort() })),
  }, null, 2));
} else {
  const migrationCount = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).length;
  console.log(`\nSchema drift — ${srcFiles.length} source files vs ${migrationCount} migrations\n`);
  console.log(`  RPCs called by the frontend:      ${calledRpcs.size}`);
  console.log(`  Relations read by the frontend:   ${calledRelations.size}\n`);

  const report = (title, names, index) => {
    if (names.length === 0) {
      console.log(`${title}: none — all accounted for.\n`);
      return;
    }
    console.log(`${title}: ${names.length}\n`);
    for (const name of names) {
      const callers = [...index.get(name)].sort();
      const shown = callers.slice(0, 3).join(', ');
      const more = callers.length > 3 ? ` (+${callers.length - 3} more)` : '';
      console.log(`  ${name.padEnd(38)} ${shown}${more}`);
    }
    console.log();
  };

  report('RPCs with no creating migration', missingRpcs, calledRpcs);
  report('Relations with no creating migration', missingRelations, calledRelations);

  if (missingRpcs.length || missingRelations.length) {
    console.log('To capture these, run supabase/diagnostics/dump_live_schema.sql');
    console.log('in the Supabase SQL editor and write the output into migration files.\n');
  }
}

if (process.argv.includes('--strict') && (missingRpcs.length || missingRelations.length)) {
  process.exit(1);
}

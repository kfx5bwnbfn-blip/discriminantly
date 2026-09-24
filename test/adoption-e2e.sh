#!/usr/bin/env bash
# End-to-end check for Recommendations Increment 1 (Adoption, migration 052).
#
# Builds a fixture with the code BEFORE 052 (every path that creates a Note,
# Mark or Itinerary, including Ensembles kept, pending and discarded), then:
#   1. page parity: the old code and the new code show every viewer the same
#      pages, except that a Note made for a pending Ensemble leaves its
#      owner's corpus (compared with the old code on the fixture minus it)
#   2. test/adoption.js: backfill, projection, privacy, transitions, invariants
#      test/lifecycle.js: editability, parent/child lifecycle, de-resolution (and the 054 backfill)
#      test/increment4.js: the Recommended experience on the web
#      test/recommendations.js: Recommendation and the additive MCP tools
#   3. test/mcp-contract.js: /mcp against the v2.56 snapshot, and against the historical submission
#
#   test/adoption-e2e.sh [pre-052 commit, default 01f2b2c] [work dir]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OLD="${1:-01f2b2c}"
W="${2:-$(mktemp -d)}"
mkdir -p "$W"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; git -C "$ROOT" worktree remove --force "$W/old" 2>/dev/null || true; }
trap cleanup EXIT
boot() { # dir code port [env...]
  local dir=$1 code=$2 port=$3; shift 3
  (cd "$code" && exec env "$@" DB_PATH="$dir/d.db" PORT="$port" node server.js >"$dir/log.txt" 2>&1) & PIDS+=($!)
  for _ in $(seq 1 50); do curl -s -o /dev/null "http://localhost:$port/" && return 0; sleep 0.2; done
  echo "server on $port did not start"; cat "$dir/log.txt"; exit 1
}
copy() { rm -rf "$W/$1"; mkdir -p "$W/$1"; cp "$W/pre/d.db" "$W/$1/d.db"; cp "$W/pre/d.db.fixture.json" "$W/$1/d.db.fixture.json"; cp -r "$W/pre/images" "$W/$1/" 2>/dev/null || true; }
q() { node --no-warnings -e "$1"; }

git -C "$ROOT" worktree add -f "$W/old" "$OLD" >/dev/null 2>&1
rm -rf "$W/pre"; mkdir -p "$W/pre"
boot "$W/pre" "$W/old" 3201 SEED=1 ADMIN_EMAIL=a@x.com ADMIN_PASSWORD=pw-long-secret ADMIN_HANDLE=elicierto
BASE=http://localhost:3201 DB_PATH="$W/pre/d.db" node --no-warnings "$ROOT/test/fixtures/build-adoption-fixture.js"
kill "${PIDS[-1]}"; sleep 1
q "new (require('node:sqlite').DatabaseSync)('$W/pre/d.db').exec('PRAGMA wal_checkpoint(TRUNCATE)')"

copy before; copy without; copy after; copy live
q "const d=new (require('node:sqlite').DatabaseSync)('$W/without/d.db');d.exec('PRAGMA foreign_keys=ON');d.prepare('DELETE FROM objects WHERE uid=?').run(require('$W/without/d.db.fixture.json').pendingNote)"
boot "$W/before" "$W/old" 3202
boot "$W/without" "$W/old" 3203
boot "$W/after" "$ROOT" 3204
for x in "3202 before" "3203 without" "3204 after"; do set -- $x
  BASE=http://localhost:$1 DB_PATH="$W/$2/d.db" node --no-warnings "$ROOT/test/adoption-pages.js" "$W/$2.json"; done
PN=$(q "const d=new (require('node:sqlite').DatabaseSync)('$W/after/d.db');const f=require('$W/after/d.db.fixture.json');console.log(d.prepare('SELECT id FROM objects WHERE uid=?').get(f.pendingNote).id)")
PE=$(q "const d=new (require('node:sqlite').DatabaseSync)('$W/after/d.db');const f=require('$W/after/d.db.fixture.json');console.log(d.prepare('SELECT id FROM ensembles WHERE uid=?').get(f.pendingEnsemble).id)")
echo; echo "page parity"
node --no-warnings "$ROOT/test/adoption-pages.js" compare "$W/before.json" "$W/without.json" "$W/after.json" "$PN" "$PE"

boot "$W/live" "$ROOT" 3205
BASE=http://localhost:3205 DB_PATH="$W/live/d.db" node --no-warnings "$ROOT/test/adoption.js"
BASE=http://localhost:3205 DB_PATH="$W/live/d.db" node --no-warnings "$ROOT/test/recommendations.js"
BASE=http://localhost:3205 DB_PATH="$W/live/d.db" node --no-warnings "$ROOT/test/tool-audit.js"
BASE=http://localhost:3205 DB_PATH="$W/live/d.db" node --no-warnings "$ROOT/test/lifecycle.js"
BASE=http://localhost:3205 DB_PATH="$W/live/d.db" node --no-warnings "$ROOT/test/increment4.js"
echo
TA=$(q "console.log(require('$W/live/d.db.fixture.json').tokA)"); SA=$(q "console.log(require('$W/live/d.db.fixture.json').sidA)")
TB=$(q "console.log(require('$W/live/d.db.fixture.json').tokB)"); SB=$(q "console.log(require('$W/live/d.db.fixture.json').sidB)")
echo; echo "/mcp, the founder's connection: exactly the v2.56 contract"
TOKEN=$TA SID=$SA BASE=http://localhost:3205 DB_PATH="$W/live/d.db" node --no-warnings "$ROOT/test/mcp-contract.js"
echo; echo "/mcp, any other member's connection: exactly the same contract"
TOKEN=$TB SID=$SB BASE=http://localhost:3205 DB_PATH="$W/live/d.db" node --no-warnings "$ROOT/test/mcp-contract.js"
echo; echo "historical regression reference: the surface submitted at v2.52.7"
TOKEN=$TA SID=$SA BASE=http://localhost:3205 DB_PATH="$W/live/d.db" node --no-warnings "$ROOT/test/mcp-contract.js" --historical
echo; echo "migration 054 backfill: re-run on this database, where test/lifecycle.js planted pre-054 dangling references"
kill "${PIDS[-1]}"; sleep 1
q "new (require('node:sqlite').DatabaseSync)('$W/live/d.db').prepare(\"DELETE FROM schema_migrations WHERE id='054-deletion-deresolves'\").run()"
boot "$W/live" "$ROOT" 3206
grep '054 de-resolution backfill' "$W/live/log.txt"
BASE=http://localhost:3206 DB_PATH="$W/live/d.db" node --no-warnings "$ROOT/test/lifecycle.js" --backfill
echo; echo "Adoption and Recommendation end-to-end: all passed. Work files in $W"

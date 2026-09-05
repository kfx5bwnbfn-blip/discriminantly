# discriminant.ly

Invite-only ledger of the world's finest goods. Zero dependencies: Node 22+, built-in SQLite.

## Run
    node server.js                      # http://localhost:3000
    SEED=1 node server.js               # first run only: adds six demo entries

First run prints the admin login and one invite code. Set your own:
    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=long-secret ADMIN_HANDLE=elicierto node server.js

## Deploy
Any host that runs Node 22: Fly, Railway, Render, or a small VPS behind Caddy/nginx.
Set NODE_ENV=production and mount a persistent volume at ./data (or set DB_PATH).
    docker build -t discriminantly . && docker run -p 3000:3000 -v $PWD/data:/app/data discriminantly

## Routes
/ feed + search · /o/:id object · /new · /u/:handle · /invites · /join?code= · /objects.json (structured data)

## Theme
Every colour, texture, and button treatment lives in the :root tokens at the top of public/style.css.
The mark is public/mark.png (original), recoloured via CSS filter. Replace with an SVG for sharper hi-dpi rendering if the vector turns up.

## Data safety

The database is a single SQLite file at `DB_PATH` (`/app/data/discriminantly.db`
in the Docker image). A deploy replaces the container, never the volume, so
mounting a Railway volume at `/app/data` is what keeps your content. Without a
volume the file lives on the container's ephemeral disk and is lost on redeploy.

**Check the boot log after every deploy.** The server prints:

    Database: /app/data/discriminantly.db (412 KB) — users 3, objects 48, marks 12, visits 30, comments 9

If those counts are zero on a site that had content, stop and check the volume
mount before doing anything else.

### Schema changes

All schema changes go in the `MIGRATIONS` array in `server.js`. Each has an id,
runs once, and is recorded in `schema_migrations`. Rules:

- **Append only.** Never edit or renumber a migration that has shipped.
- **Additive only.** Add tables and columns; do not drop or rename. A column
  the code stops using costs nothing to leave in place.
- Before any migration runs, a snapshot is written to `data/backups/`.
- Each migration runs in a transaction. If one fails the boot aborts with a
  non-zero exit, so Railway keeps the previous deployment serving.

Adding a column looks like this:

    ['008-marks-neighbourhood', addColumn('marks', 'neighbourhood', "TEXT DEFAULT ''")],

### Backups

- Automatic: written to `data/backups/` before any pending migration.
- On demand: `node server.js --backup [file]`
- Over the wire: sign in as admin and visit `/admin/backup` to download a
  consistent snapshot.

Snapshots use `VACUUM INTO`, so they are safe to take while the server is
running. Restoring is a file copy: stop the service, replace the file at
`DB_PATH`, start it again.

### Rules of thumb

- Keep the service at **one instance**. SQLite is a file; two containers writing
  to one volume will corrupt it.
- Take a Railway volume snapshot before anything unusual.
- Leave `SEED` unset after the first run. It only fires when the users table is
  empty, but there is no reason to keep it around.

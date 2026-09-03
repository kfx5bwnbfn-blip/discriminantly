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

# Running it on a server

The app is made to run on your own computer. You can put it on a server you control, but then it is reachable from the internet and holds your CV, so take these seriously:

- **HTTPS only.** Put it behind a reverse proxy with a certificate. The sign-in is HTTP Basic authentication; without HTTPS the password travels in the clear.
- **A long, unique password** in `HQ_ACCESS_PASSWORD`. It is the only thing between the internet and your records.
- Set `HQ_PUBLIC_ORIGIN` to the public address, for example `https://jobs.example.com`. The app refuses changes that do not come from that address.
- Set `HOST=0.0.0.0` only if the proxy runs on another machine; otherwise keep the default `127.0.0.1` so the app is reachable through the proxy alone.
- Keep the `data` folder outside any directory the web server serves, readable only by the user the app runs as, and include it in your backups.
- The app is for one person. Do not share the password to give somebody else "an account"; they would see everything.

## Steps

```bash
git clone https://github.com/Emad-doz/job-hunt.git
cd job-hunt
npm ci
npm run build
cp .env.example .env      # set HQ_ACCESS_PASSWORD, HQ_PUBLIC_ORIGIN
npm start
```

Run `npm start` under a process manager of your choice so it restarts with the server, and point the proxy at `http://127.0.0.1:3000`.

## Updating

```bash
git pull
npm ci
npm run build
```

and restart. The `data` folder is not touched by an update.

## Building costs processor time

`npm run build` compiles the page and takes a noticeable amount of CPU for a short while. On hosting plans that meter CPU seconds, build on your own computer and upload the result, or update rarely.

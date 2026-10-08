# Job Hunt

A private job-search workbench that runs on your own computer. It finds vacancies, screens them against your CV, keeps track of what you applied to, and prepares a CV for each vacancy. Your records stay in a database file on your machine. There is no account, no shared server and no telemetry.

**Status: early.** It works end to end, but it grew out of one person's own job search and some parts still show that; see [Known limits](#known-limits).

## What it does

- **Today.** One button searches your vacancy sources, screens what is new, and shows what needs a decision.
- **Jobs.** Every vacancy in one list: discoveries, applications, interviews, offers, rejections, an archive. You change a status with a note; nothing changes on its own.
- **My CV.** Upload your CV as a PDF, keep your details as editable fields, choose one of four templates and download a PDF. With an AI key, the fields can be filled from your PDF and the CV can be adapted to one vacancy, using only what is in your details.
- **Screening.** Rule-based by default. With an AI key, vacancies are judged against your CV, with reasons, and a motivation text can be drafted for one vacancy.
- **Replies.** Optionally reads your Outlook mailbox when you ask, links replies to applications and proposes a status. You confirm every change.

The app never applies for a job, never sends a message, and never changes a status by itself.

## Quick start

You need [Node.js](https://nodejs.org) 22.13 or newer.

```bash
git clone https://github.com/Emad-doz/job-hunt.git
cd job-hunt
npm ci
npm run build
```

Copy `.env.example` to `.env` and set a password of at least 20 characters:

```
HQ_ACCESS_PASSWORD=choose-a-long-password-here
```

Then start it:

```bash
npm start
```

Open <http://localhost:3000> and sign in with the user name `owner` and your password. Go to **Settings → Setup** and follow the steps. To look around first without your own data, run `npm run demo` and open <http://127.0.0.1:5173>: it shows fictional records only.

## Setup steps

The Setup page shows these with their real state:

1. **Set your password and sign in.** Done by the `.env` file above.
2. **Your database.** Nothing to do: a database file is created in the `data` folder. See [docs/database.md](docs/database.md) for backups and the MySQL option.
3. **Add your CV.** Upload a PDF on My CV and fill in your details.
4. **Say where you search.** Your town or region, your country code, and the roles you look for.
5. **Connect a vacancy source.** A free key from JSearch or Adzuna, or employer career pages without any key. See [docs/vacancy-sources.md](docs/vacancy-sources.md).
6. **Switch on the AI model** (optional). Your own Anthropic API key. See [docs/ai-model.md](docs/ai-model.md).
7. **Connect your mailbox** (optional). Outlook or Hotmail. See [docs/mail.md](docs/mail.md).

## Where your data is

Everything is in the `data` folder next to the app:

- `job-hunt.db`: your jobs, their history, your CV file, photo and details.
- `settings.enc`: your settings and keys, encrypted with your password.

Both are listed in `.gitignore`. The repository itself contains no personal data, and the tests use made-up records only.

What leaves your machine, and only then:

| When | What is sent | To |
|---|---|---|
| A search runs | Your role search terms and search area. Never your CV. | The vacancy sources you connected |
| You start a screening, an assessment, a motivation draft, "Fill from my CV" or "Adapt my CV" | CV text or details, and the vacancy text | Anthropic, with your own API key |
| You press "Check for replies" | A read-only request for your recent mail | Microsoft, for your own mailbox |

Without an AI key and without a mailbox connection, the second and third rows never happen.

The records in `job-hunt.db` are not encrypted. Anyone who can read your files can read them, as with any document on your computer. If you put the app on a server, read [docs/hosting.md](docs/hosting.md) first.

## Commands

```bash
npm run build      # compile the app into dist/
npm start          # run it on http://localhost:3000
npm run demo       # fictional records on http://127.0.0.1:5173
npm run typecheck
npm test           # synthetic checks; no network, no real data (build first)
```

## Known limits

- **AI:** only Anthropic's Claude models are supported.
- **Mail:** only Outlook and Hotmail. Gmail is not supported yet.
- **Languages:** the rules that read reply emails (rejection, invitation, offer) know English and Dutch wording.
- **Rule-based screening:** the keyword rules that derive searches from a CV were written for digital, analytics and e-commerce roles. With an AI key, screening works for any profession; without one, enter your role searches yourself in Search settings.
- **Adzuna** covers a limited set of countries; JSearch covers more.
- **One user.** There are no accounts; the password protects the whole app.
- The mailbox sign-in on `http://localhost` and the MySQL option have been tested with stand-ins and on one hosted setup, not on a range of machines.

## How it is built

A React page (`app/`) and a small Node server (`server/`) with no framework. `server/records.mjs` holds the only operations that may change a record; each runs in one transaction. `server/store-local.mjs` is the SQLite store and `server/db-client.mjs` the optional MySQL one. `server/model-client.mjs` is the one file that talks to the Anthropic SDK. Tests live in `tests/`, one script per area.

## Licence

MIT. See [LICENSE](LICENSE).

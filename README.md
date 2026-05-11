# Ghostwriter

Ghostwriter now includes:

- a **Python NFC machine controller + API** for submitting tag write jobs and reading live machine status
- an in-repo **Next.js operator dashboard** for building tag batches and starting jobs from the browser
- a **Supabase-backed backend job integration** for choosing remote `writer_jobs` and writing status updates back to the database

## Repo layout

```text
.
├── api_server.py          # FastAPI server for machine control/status
├── nfc_controller.py      # Reusable NFC writer controller + CLI entrypoint
├── stepper.py             # Low-level stepper control
├── requirements.txt       # Python dependencies
└── web/                   # Next.js operator UI
```

## Python API

The Python side keeps ownership of the hardware logic and exposes HTTP endpoints for the UI.

### Endpoints

- `GET /api/status`
  - current machine state
  - active/recent job progress
  - last UID, last message, last error
  - backend writer integration status and realtime connection state
- `GET /api/jobs/current`
  - current job details and per-tag results
- `POST /api/jobs`
  - submit a new tag write job
- `GET /api/backend/jobs`
  - list unfinished Supabase `writer_jobs` for the configured writer key
- `POST /api/backend/jobs/start`
  - manually start a selected Supabase backend job on the local machine

Example payload:

```json
{
  "tags": [
    { "url": "https://example.com/tag-1" },
    { "url": "https://example.com/tag-2" }
  ]
}
```

## Setup

### 1) Python dependencies

Create and activate a virtual environment if desired, then install requirements:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2) Run the machine API

```bash
uvicorn api_server:app --host 0.0.0.0 --port 8000
```

### 2a) Configure Supabase backend jobs

Create a repo-root `.env` file for the Python API / Pi worker:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://vxelgqdynmkvedmdwvxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NFC_WRITER_KEY=default
```

Notes:

- the Python controller reads the root `.env` automatically on startup
- `NFC_WRITER_KEY` defaults to `default` if omitted
- the Pi fetches unfinished backend jobs for that writer key and listens for Realtime `writer:jobs:{writerKey}` broadcasts
- backend jobs are **manual start** in the dashboard; they do not auto-run when received

This starts the local API at:

```text
http://localhost:8000
```

## Next.js dashboard

The operator dashboard lives in `web/`.

### Tag job creation modes

The dashboard now supports three ways to prepare a tag job:

- **Manual entry** — add or remove individual URL rows
- **Import JSON / CSV** — bulk load tag URLs from a file
- **Testing tag creator wizard** — generate tag URLs from a count and incrementing integer pattern
- **Backend writer jobs** — choose an unfinished Supabase `writer_jobs` record for the current writer and start it manually

### Supabase backend job flow

When a backend job is started from the dashboard:

1. The local API fetches the selected `writer_jobs` row for the configured `NFC_WRITER_KEY`.
2. It extracts `request_payload.tags[].launchUrl` and reuses the existing NFC write loop.
3. The row is updated back to Supabase as:
   - `processing` when the machine begins the job
   - `completed` with `result_payload.writtenCount` when all tags are written
   - `failed` with `error_message` if the write fails or the operator cancels the job

On startup, the Pi also queries unfinished backend jobs (`queued`, `sent`, `processing`) before relying on live Realtime events.

#### Supported JSON import formats

```json
["https://example.com/1", "https://example.com/2"]
```

```json
[{ "url": "https://example.com/1" }, { "url": "https://example.com/2" }]
```

```json
{
  "tags": [
    { "url": "https://example.com/1" },
    { "url": "https://example.com/2" }
  ]
}
```

#### Supported CSV import format

Header row is optional. Only the first column is used.

```csv
url
https://example.com/1
https://example.com/2
```

#### Testing tag creator wizard

Use a URL pattern containing a `{n}` placeholder, for example:

```text
https://example.com/tag-{n}
```

The wizard lets operators choose:

- start number
- tag count
- increment
- optional zero-padding width

Example with start `1`, count `3`, and pad width `3`:

```text
https://example.com/tag-001
https://example.com/tag-002
https://example.com/tag-003
```

Import and wizard flows can either **replace** the current tag list or **append** to it.

### Install dependencies

```bash
cd web
npm install
```

### Configure API base URL

By default, the dashboard talks to:

```text
http://localhost:8000
```

To override it, create `web/.env.local`:

```bash
NEXT_PUBLIC_GHOSTWRITER_API_BASE_URL=http://<machine-host>:8000
```

### Run the dashboard

```bash
cd web
npm run dev
```

> Note: on Linux ARM machines, Next.js 16 dev mode must run with Webpack because
> Turbopack native bindings are not available there. The repo's `npm run dev`
> script is already configured for this.
>
> If you access the dev server through a custom hostname such as
> `ghostwriter.local`, that hostname must also be allowed in `web/next.config.ts`
> via `allowedDevOrigins`.

Open:

```text
http://localhost:3000
```

## Development workflow

Run these in separate terminals:

### Terminal 1: Python API

```bash
uvicorn api_server:app --host 0.0.0.0 --port 8000
```

### Terminal 2: Next.js app

```bash
cd web
npm run dev
```

## Existing CLI behavior

You can still run the writer directly from Python for manual testing:

```bash
python nfc_controller.py
```

That path now uses the refactored controller internally.

## Production setup (auto-start on Pi boot)

This produces a pre-compiled Next.js bundle served by `next start` and two
systemd services that bring everything up automatically when the Pi powers on.

### 1) Build the Next.js app

Run this once (and again after any UI code changes):

```bash
cd web
npm run build
```

The compiled output lands in `web/.next/`.

> **Important:** `web/.env.local` is read **at build time**, not at runtime.
> Make sure it contains the correct `NEXT_PUBLIC_GHOSTWRITER_API_BASE_URL`
> before running `npm run build`.

### 2) Verify the production server works manually (optional)

```bash
# Terminal 1
uvicorn api_server:app --host 0.0.0.0 --port 8000

# Terminal 2
cd web
npm start
```

Browse to `http://ghostwriter.local:3000` and confirm everything works before
wiring up auto-start.

### 3) Install the systemd services

The repo ships ready-made service files in `deploy/`. Copy them to systemd and
enable them:

```bash
sudo cp deploy/ghostwriter-api.service /etc/systemd/system/
sudo cp deploy/ghostwriter-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ghostwriter-api.service ghostwriter-web.service
sudo systemctl start  ghostwriter-api.service ghostwriter-web.service
```

Both services use `User=pi` and expect the repo at `/home/pi/ghostwriter`.
Edit the service files before copying if your username or path differs.

### 4) Check status and logs

```bash
sudo systemctl status ghostwriter-api
sudo systemctl status ghostwriter-web

# Live logs
journalctl -u ghostwriter-api -f
journalctl -u ghostwriter-web -f
```

### 5) Updating the UI after code changes

```bash
cd /home/pi/ghostwriter/web
npm run build
sudo systemctl restart ghostwriter-web.service
```

The Python API does not need a rebuild — just `sudo systemctl restart ghostwriter-api.service` if you edit `api_server.py` or `nfc_controller.py`.

---

## Verification performed

The following checks were run successfully:

```bash
python -m py_compile nfc_controller.py api_server.py stepper.py
cd web && npm run build
```

Additional frontend utility coverage is available via:

```bash
cd web
npm test
```

## Notes

- v1 supports **one active job at a time**
- job/runtime state is stored **in memory**
- the dashboard polls the API for live updates
- hardware control remains in Python, not in Next.js

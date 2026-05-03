# Ghostwriter

Ghostwriter now includes:

- a **Python NFC machine controller + API** for submitting tag write jobs and reading live machine status
- an in-repo **Next.js operator dashboard** for building tag batches and starting jobs from the browser

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
- `GET /api/jobs/current`
  - current job details and per-tag results
- `POST /api/jobs`
  - submit a new tag write job

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

This starts the local API at:

```text
http://localhost:8000
```

## Next.js dashboard

The operator dashboard lives in `web/`.

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

## Verification performed

The following checks were run successfully:

```bash
python -m py_compile nfc_controller.py api_server.py stepper.py
cd web && npm run build
```

## Notes

- v1 supports **one active job at a time**
- job/runtime state is stored **in memory**
- the dashboard polls the API for live updates
- hardware control remains in Python, not in Next.js

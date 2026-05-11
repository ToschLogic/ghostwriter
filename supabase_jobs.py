import asyncio
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import requests
import websockets

from env_loader import load_env_file

logger = logging.getLogger(__name__)

UNFINISHED_REMOTE_STATUSES = ("queued", "sent", "processing")


@dataclass(slots=True)
class SupabaseWriterJob:
    id: str
    writer_key: str
    status: str
    created_at: str | None
    request_payload: dict[str, Any]

    @property
    def requested_at(self) -> str | None:
        value = self.request_payload.get("requestedAt")
        return value if isinstance(value, str) else None

    @property
    def lot(self) -> dict[str, Any]:
        lot = self.request_payload.get("lot")
        return lot if isinstance(lot, dict) else {}

    @property
    def lot_name(self) -> str | None:
        value = self.lot.get("name")
        return value if isinstance(value, str) else None

    @property
    def tag_count(self) -> int:
        tags = self.request_payload.get("tags")
        return len(tags) if isinstance(tags, list) else 0

    def to_summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "writerKey": self.writer_key,
            "status": self.status,
            "createdAt": self.created_at,
            "requestedAt": self.requested_at,
            "tagCount": self.tag_count,
            "lotName": self.lot_name,
            "jobType": self.request_payload.get("jobType"),
            "jobOptions": self.request_payload.get("jobOptions") or {},
        }


def extract_launch_urls(request_payload: dict[str, Any]) -> list[str]:
    tags = request_payload.get("tags")
    if not isinstance(tags, list):
        return []

    urls: list[str] = []
    for tag in tags:
        if not isinstance(tag, dict):
            continue
        launch_url = tag.get("launchUrl")
        if isinstance(launch_url, str) and launch_url.strip():
            urls.append(launch_url.strip())
    return urls


class SupabaseJobManager:
    def __init__(self):
        load_env_file()

        self.supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
        self.anon_key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
        self.service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        self.writer_key = os.environ.get("NFC_WRITER_KEY", "default")

        self._lock = threading.RLock()
        self._available_jobs: dict[str, SupabaseWriterJob] = {}
        self._realtime_status = "disabled"
        self._last_error: str | None = None
        self._listener_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._next_ref = 1

        if self.is_enabled:
            self.refresh_jobs()
            self._listener_thread = threading.Thread(
                target=self._run_listener,
                daemon=True,
                name="supabase-realtime-listener",
            )
            self._listener_thread.start()

    @property
    def is_enabled(self) -> bool:
        return bool(self.supabase_url and self.anon_key and self.service_role_key)

    def get_status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "enabled": self.is_enabled,
                "writerKey": self.writer_key,
                "realtimeStatus": self._realtime_status,
                "availableJobCount": len(self._available_jobs),
                "lastError": self._last_error,
            }

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            jobs = sorted(
                self._available_jobs.values(),
                key=lambda job: (job.created_at or "", job.id),
            )
            return [job.to_summary() for job in jobs]

    def get_job(self, job_id: str) -> SupabaseWriterJob | None:
        with self._lock:
            cached = self._available_jobs.get(job_id)
            if cached is not None:
                return cached

        params = {
            "select": "*",
            "id": f"eq.{job_id}",
            "writer_key": f"eq.{self.writer_key}",
        }
        rows = self._rest_request("GET", "/rest/v1/writer_jobs", params=params)
        if not rows:
            return None
        return self._parse_job(rows[0])

    def refresh_jobs(self) -> list[dict[str, Any]]:
        if not self.is_enabled:
            return []

        params = {
            "select": "*",
            "writer_key": f"eq.{self.writer_key}",
            "status": f"in.({','.join(UNFINISHED_REMOTE_STATUSES)})",
            "order": "created_at.asc",
        }
        rows = self._rest_request("GET", "/rest/v1/writer_jobs", params=params)
        jobs = [self._parse_job(row) for row in rows]
        with self._lock:
            self._available_jobs = {job.id: job for job in jobs}
        return [job.to_summary() for job in jobs]

    def mark_processing(self, job_id: str) -> None:
        self._update_job(
            job_id,
            {
                "status": "processing",
                "started_at": self._utc_now(),
                "completed_at": None,
                "error_message": None,
            },
        )

    def mark_completed(self, job_id: str, *, written_count: int) -> None:
        self._update_job(
            job_id,
            {
                "status": "completed",
                "completed_at": self._utc_now(),
                "error_message": None,
                "result_payload": {"writtenCount": written_count},
            },
        )

    def mark_failed(self, job_id: str, message: str) -> None:
        self._update_job(
            job_id,
            {
                "status": "failed",
                "completed_at": self._utc_now(),
                "error_message": message,
            },
        )

    def _update_job(self, job_id: str, payload: dict[str, Any]) -> None:
        headers = {"Prefer": "return=minimal"}
        self._rest_request(
            "PATCH",
            "/rest/v1/writer_jobs",
            params={"id": f"eq.{job_id}"},
            json_body=payload,
            extra_headers=headers,
        )
        self.refresh_jobs()

    def _rest_request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json_body: Any = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        if not self.is_enabled:
            raise RuntimeError("Supabase integration is not configured")

        url = f"{self.supabase_url}{path}"
        headers = {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Content-Type": "application/json",
        }
        if extra_headers:
            headers.update(extra_headers)

        response = requests.request(method, url, headers=headers, params=params, json=json_body, timeout=20)
        if not response.ok:
            raise RuntimeError(f"Supabase {method} {path} failed: {response.status_code} {response.text}")

        if not response.content:
            return None

        return response.json()

    def _parse_job(self, row: dict[str, Any]) -> SupabaseWriterJob:
        payload = row.get("request_payload") or {}
        if not isinstance(payload, dict):
            payload = {}
        return SupabaseWriterJob(
            id=str(row.get("id")),
            writer_key=str(row.get("writer_key") or self.writer_key),
            status=str(row.get("status") or "queued"),
            created_at=row.get("created_at"),
            request_payload=payload,
        )

    def _run_listener(self) -> None:
        while not self._stop_event.is_set():
            try:
                asyncio.run(self._listen_forever())
            except Exception as exc:  # pragma: no cover - defensive reconnect loop
                logger.exception("Supabase realtime listener crashed")
                with self._lock:
                    self._realtime_status = "error"
                    self._last_error = str(exc)
                if self._stop_event.wait(5):
                    return

    async def _listen_forever(self) -> None:
        ws_url = self._build_websocket_url()
        topic = f"realtime:writer:jobs:{self.writer_key}"
        join_message = {
            "topic": topic,
            "event": "phx_join",
            "payload": {
                "config": {
                    "broadcast": {"ack": False, "self": False},
                    "presence": {"key": ""},
                    "postgres_changes": [],
                    "private": False,
                }
            },
            "ref": self._next_reference(),
        }

        async with websockets.connect(ws_url, ping_interval=None) as websocket:
            with self._lock:
                self._realtime_status = "connecting"
                self._last_error = None

            await websocket.send(json.dumps(join_message))

            heartbeat_task = asyncio.create_task(self._heartbeat_loop(websocket))
            try:
                async for raw_message in websocket:
                    message = json.loads(raw_message)
                    await self._handle_realtime_message(message)
            finally:
                heartbeat_task.cancel()
                with self._lock:
                    if self._realtime_status != "error":
                        self._realtime_status = "disconnected"

    async def _heartbeat_loop(self, websocket) -> None:
        while True:
            await asyncio.sleep(25)
            await websocket.send(
                json.dumps(
                    {
                        "topic": "phoenix",
                        "event": "heartbeat",
                        "payload": {},
                        "ref": self._next_reference(),
                    }
                )
            )

    async def _handle_realtime_message(self, message: dict[str, Any]) -> None:
        event = message.get("event")
        payload = message.get("payload") or {}

        if event == "phx_reply":
            status = payload.get("status")
            with self._lock:
                self._realtime_status = "connected" if status == "ok" else "error"
                self._last_error = None if status == "ok" else str(payload)
            return

        if event == "broadcast" and payload.get("event") == "writer_job":
            logger.info("Received Supabase writer_job broadcast for writer_key=%s", self.writer_key)
            self.refresh_jobs()

    def _build_websocket_url(self) -> str:
        if self.supabase_url.startswith("https://"):
            base = "wss://" + self.supabase_url.removeprefix("https://")
        elif self.supabase_url.startswith("http://"):
            base = "ws://" + self.supabase_url.removeprefix("http://")
        else:
            base = self.supabase_url
        query = urlencode({"apikey": self.anon_key, "vsn": "1.0.0"})
        return f"{base}/realtime/v1/websocket?{query}"

    def _next_reference(self) -> str:
        with self._lock:
            value = str(self._next_ref)
            self._next_ref += 1
            return value

    @staticmethod
    def _utc_now() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
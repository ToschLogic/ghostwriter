import signal
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any
from uuid import uuid4

import board
import busio
from adafruit_pn532.spi import PN532_SPI
from digitalio import DigitalInOut

from stepper import A4988Stepper

STEP_PIN = 18
DIR_PIN = 23
ENABLE_PIN = 24

DEFAULT_STEP_COUNT_PER_TAG = 64
DEFAULT_POLL_DELAY_S = 0.1
DEFAULT_SAME_TAG_SKIP_DELAY_S = 2.0


def _format_uid(uid_bytes: bytes) -> str:
    return "-".join(f"{byte:02X}" for byte in uid_bytes)


def _exit_cleanly(signum, frame):
    """
    Convert process signals into a normal Python exit so main()'s finally block
    runs and the A4988 ENABLE pin is driven inactive before the program exits.
    """
    raise SystemExit(0)


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# def write_ndef_url(pn532, url: str, *, wipe_unused: bool = True) -> bool:
#     """
#     Write a URL as an NDEF URI record to an NTAG215.

#     Returns True on success, False on failure.

#     Assumptions:
#     - Tag is NTAG215 / NFC Forum Type 2
#     - Tag is already in the RF field
#     - Capability Container at page 3 is already valid
#     - User memory starts at page 4
#     """

#     if not isinstance(url, str) or not url:
#         raise ValueError("url must be a non-empty string")

#     # Encode as UTF-8 bytes.
#     # For ordinary URLs, ASCII and UTF-8 are equivalent.
#     url_bytes = url.encode("utf-8")

#     # Use URI Identifier Code 0x00 = no prefix compression.
#     # This is simple and broadly compatible.
#     uri_identifier_code = 0x00

#     # NDEF URI record payload = [URI ID CODE][URL BYTES]
#     uri_payload = bytes([uri_identifier_code]) + url_bytes

#     # NDEF short record:
#     # MB=1 ME=1 CF=0 SR=1 IL=0 TNF=0x1  => 0xD1
#     # TYPE LENGTH = 1 ('U')
#     # PAYLOAD LENGTH = len(uri_payload)
#     # TYPE = 0x55 ('U')
#     if len(uri_payload) > 255:
#         raise ValueError("URL too long for short-record URI encoding")

#     ndef_message = bytes([
#         0xD1,               # NDEF header: well-known, short record, MB/ME set
#         0x01,               # TYPE LENGTH = 1
#         len(uri_payload),   # PAYLOAD LENGTH
#         0x55,               # TYPE = 'U' (URI)
#     ]) + uri_payload

#     # Wrap the NDEF message in a Type 2 Tag TLV.
#     # For normal URL sizes, short TLV length is fine.
#     if len(ndef_message) < 0xFF:
#         tlv = bytes([
#             0x03,                 # NDEF Message TLV
#             len(ndef_message),    # TLV length
#         ]) + ndef_message + bytes([0xFE])   # Terminator TLV
#     else:
#         # Long-form TLV length if ever needed
#         tlv = bytes([
#             0x03,
#             0xFF,
#             (len(ndef_message) >> 8) & 0xFF,
#             len(ndef_message) & 0xFF,
#         ]) + ndef_message + bytes([0xFE])

#     # NTAG215 user memory:
#     # 504 bytes = 126 pages * 4 bytes
#     # user pages are page 4 through page 129 inclusive
#     USER_START_PAGE = 4
#     USER_END_PAGE = 129
#     USER_BYTES = (USER_END_PAGE - USER_START_PAGE + 1) * 4

#     if len(tlv) > USER_BYTES:
#         raise ValueError(
#             f"NDEF payload too large for NTAG215 user memory "
#             f"({len(tlv)} bytes > {USER_BYTES} bytes)"
#         )

#     # Pad to full pages (4 bytes/page) for write_block().
#     padded = tlv
#     if len(padded) % 4 != 0:
#         padded += b"\x00" * (4 - (len(padded) % 4))

#     total_pages_needed = len(padded) // 4
#     start_page = USER_START_PAGE

#     # Write page-by-page.
#     for page_offset in range(total_pages_needed):
#         page = start_page + page_offset
#         block = padded[page_offset * 4 : (page_offset + 1) * 4]

#         ok = pn532.ntag2xx_write_block(page, block)
#         if not ok:
#             print(f"Write failed on page {page}")
#             return False

#         # Small pacing delay helps some tag/reader combinations
#         time.sleep(0.01)

#     # Optional: wipe the rest of the user area after the terminator.
#     # This avoids stale data after rewriting shorter URLs over older longer ones.
#     if wipe_unused:
#         first_unused_page = start_page + total_pages_needed
#         for page in range(first_unused_page, USER_END_PAGE + 1):
#             ok = pn532.ntag2xx_write_block(page, b"\x00\x00\x00\x00")
#             if not ok:
#                 print(f"Wipe failed on page {page}")
#                 return False
#             time.sleep(0.005)

#     # Verify by reading back the pages we wrote and comparing bytes.
#     read_back = bytearray()
#     for page_offset in range(total_pages_needed):
#         page = start_page + page_offset
#         data = pn532.ntag2xx_read_block(page)
#         if data is None or len(data) != 4:
#             print(f"Read-back failed on page {page}")
#             return False
#         read_back.extend(data)
#         time.sleep(0.005)

#     if bytes(read_back[:len(tlv)]) != tlv:
#         print("Verify mismatch after write")
#         return False

#     return True



def _ndef_uri_prefix_and_rest(url: str) -> tuple[int, bytes]:
    prefixes = [
        ("https://www.", 0x02),
        ("http://www.", 0x01),
        ("https://", 0x04),
        ("http://", 0x03),
    ]
    for prefix, code in prefixes:
        if url.startswith(prefix):
            return code, url[len(prefix):].encode("utf-8")
    return 0x00, url.encode("utf-8")


def _build_ndef_tlv_for_url(url: str) -> bytes:
    uri_identifier_code, rest = _ndef_uri_prefix_and_rest(url)
    uri_payload = bytes([uri_identifier_code]) + rest

    if len(uri_payload) > 255:
        raise ValueError("URL too long for short-record URI encoding")

    ndef_message = bytes([
        0xD1,               # MB/ME/SR + TNF=Well Known
        0x01,               # type length
        len(uri_payload),   # payload length
        0x55,               # 'U' = URI record
    ]) + uri_payload

    if len(ndef_message) < 0xFF:
        tlv = bytes([0x03, len(ndef_message)]) + ndef_message + bytes([0xFE])
    else:
        tlv = bytes([
            0x03, 0xFF,
            (len(ndef_message) >> 8) & 0xFF,
            len(ndef_message) & 0xFF,
        ]) + ndef_message + bytes([0xFE])

    return tlv


def _read_exact_pages(pn532, start_page: int, byte_count: int, retries: int = 3, delay_s: float = 0.03):
    pages_needed = (byte_count + 3) // 4

    for attempt in range(retries):
        buf = bytearray()
        ok = True

        for page in range(start_page, start_page + pages_needed):
            data = pn532.ntag2xx_read_block(page)
            if data is None or len(data) != 4:
                ok = False
                break
            buf.extend(data)
            time.sleep(delay_s)

        if ok:
            return bytes(buf[:byte_count])

        time.sleep(0.08)

    return None


def write_ndef_url(pn532, url: str, *, wipe_unused: bool = False, debug: bool = True) -> bool:
    """
    Write a URL NDEF record to an NTAG215.
    Optimized for reliability during bench testing.
    """
    if not isinstance(url, str) or not url:
        raise ValueError("url must be a non-empty string")

    tlv = _build_ndef_tlv_for_url(url)

    USER_START_PAGE = 4
    USER_END_PAGE = 129
    USER_BYTES = (USER_END_PAGE - USER_START_PAGE + 1) * 4

    if len(tlv) > USER_BYTES:
        raise ValueError(f"NDEF too large for NTAG215: {len(tlv)} > {USER_BYTES}")

    padded = tlv
    if len(padded) % 4 != 0:
        padded += b"\x00" * (4 - (len(padded) % 4))

    total_pages_needed = len(padded) // 4

    # Write only the pages we actually need
    for page_offset in range(total_pages_needed):
        page = USER_START_PAGE + page_offset
        block = padded[page_offset * 4 : (page_offset + 1) * 4]

        ok = pn532.ntag2xx_write_block(page, block)
        if not ok:
            if debug:
                print(f"Write failed on page {page}")
            return False

        time.sleep(0.02)

    # Optional short cleanup only for the next couple pages, not the whole tag
    if wipe_unused:
        for page in range(USER_START_PAGE + total_pages_needed,
                          min(USER_START_PAGE + total_pages_needed + 2, USER_END_PAGE + 1)):
            ok = pn532.ntag2xx_write_block(page, b"\x00\x00\x00\x00")
            if not ok:
                if debug:
                    print(f"Optional cleanup failed on page {page}")
                return False
            time.sleep(0.02)

    # Let the tag settle before verify
    time.sleep(0.10)

    read_back = _read_exact_pages(pn532, USER_START_PAGE, len(tlv), retries=3, delay_s=0.02)
    if read_back is None:
        if debug:
            print("Read-back failed after retries")
        return False

    if read_back != tlv:
        if debug:
            print("Verify mismatch")
            print("Expected:", tlv.hex())
            print("Actual:  ", read_back.hex())
        return False

    return True

def init_pn532():
    spi = busio.SPI(board.SCK, board.MOSI, board.MISO)
    cs_pin = DigitalInOut(board.CE0)
    pn532 = PN532_SPI(spi, cs_pin, debug=False)
    pn532.SAM_configuration()
    return pn532


@dataclass(slots=True)
class TagWriteRequest:
    url: str


@dataclass(slots=True)
class TagWriteResult:
    index: int
    url: str
    status: str = "pending"
    uid: str | None = None
    message: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


@dataclass(slots=True)
class WriterJob:
    tags: list[TagWriteRequest]
    job_id: str = field(default_factory=lambda: str(uuid4()))
    state: str = "queued"
    created_at: str = field(default_factory=_utc_now)
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None
    current_tag_index: int | None = None
    current_uid: str | None = None
    results: list[TagWriteResult] = field(default_factory=list)

    def __post_init__(self):
        if not self.results:
            self.results = [
                TagWriteResult(index=index + 1, url=tag.url)
                for index, tag in enumerate(self.tags)
            ]


class NFCWriterController:
    def __init__(
        self,
        *,
        step_count_per_tag: int = DEFAULT_STEP_COUNT_PER_TAG,
        poll_delay_s: float = DEFAULT_POLL_DELAY_S,
        same_tag_skip_delay_s: float = DEFAULT_SAME_TAG_SKIP_DELAY_S,
    ):
        self.step_count_per_tag = step_count_per_tag
        self.poll_delay_s = poll_delay_s
        self.same_tag_skip_delay_s = same_tag_skip_delay_s
        self._lock = threading.RLock()
        self._job_thread: threading.Thread | None = None
        self._current_job: WriterJob | None = None
        self._last_message = "idle"
        self._last_error: str | None = None
        self._last_uid: str | None = None
        self._updated_at = _utc_now()

    def submit_job(self, tags: list[TagWriteRequest]) -> WriterJob:
        if not tags:
            raise ValueError("at least one tag is required")

        with self._lock:
            if self._job_thread is not None and self._job_thread.is_alive():
                raise RuntimeError("writer is already running a job")

            job = WriterJob(tags=tags)
            self._current_job = job
            self._last_error = None
            self._last_message = f"job {job.job_id} queued"
            self._updated_at = _utc_now()
            self._job_thread = threading.Thread(
                target=self._run_job,
                args=(job,),
                daemon=True,
                name=f"nfc-writer-{job.job_id}",
            )
            self._job_thread.start()
            return job

    def get_current_job_data(self) -> dict[str, Any] | None:
        with self._lock:
            if self._current_job is None:
                return None
            return self._serialize_job(self._current_job)

    def get_status(self) -> dict[str, Any]:
        with self._lock:
            job = self._current_job
            state = "idle"
            total_tags = 0
            completed_tags = 0
            current_tag_number = None

            if job is not None:
                state = job.state
                total_tags = len(job.tags)
                completed_tags = sum(1 for result in job.results if result.status == "written")
                current_tag_number = job.current_tag_index

            return {
                "state": state,
                "jobId": job.job_id if job else None,
                "totalTags": total_tags,
                "completedTags": completed_tags,
                "currentTagNumber": current_tag_number,
                "lastUid": self._last_uid,
                "lastMessage": self._last_message,
                "lastError": self._last_error,
                "updatedAt": self._updated_at,
                "job": self.get_current_job_data(),
            }

    def _set_message(self, message: str, *, error: str | None = None):
        with self._lock:
            self._last_message = message
            self._last_error = error
            self._updated_at = _utc_now()

    def _run_job(self, job: WriterJob):
        pn532 = None
        stepper = None
        last_written_uid: bytes | None = None
        written_uids: set[bytes] = set()
        last_skip_log_time = 0.0

        try:
            with self._lock:
                job.state = "running"
                job.started_at = _utc_now()
                self._updated_at = _utc_now()
                self._last_message = f"job {job.job_id} started"

            pn532 = init_pn532()
            stepper = A4988Stepper(STEP_PIN, DIR_PIN, ENABLE_PIN)

            for index, result in enumerate(job.results):
                with self._lock:
                    job.current_tag_index = result.index
                    result.status = "waiting-for-tag"
                    result.started_at = _utc_now()
                    self._updated_at = _utc_now()
                    self._last_message = f"waiting for tag {result.index} of {len(job.results)}"

                while True:
                    uid = pn532.read_passive_target(timeout=0.5)

                    if not uid:
                        time.sleep(self.poll_delay_s)
                        continue

                    uid_bytes = bytes(uid)
                    uid_display = _format_uid(uid_bytes)

                    if last_written_uid is not None and uid_bytes == last_written_uid:
                        now = time.monotonic()
                        if now - last_skip_log_time >= self.same_tag_skip_delay_s:
                            self._set_message(f"Tag UID {uid_display} is still under the reader; waiting for the next tag")
                            last_skip_log_time = now
                        time.sleep(self.same_tag_skip_delay_s)
                        continue

                    if uid_bytes in written_uids:
                        now = time.monotonic()
                        if now - last_skip_log_time >= self.same_tag_skip_delay_s:
                            self._set_message(f"Tag UID {uid_display} already written; remove it before continuing")
                            last_skip_log_time = now
                        time.sleep(self.same_tag_skip_delay_s)
                        continue

                    with self._lock:
                        job.current_uid = uid_display
                        self._last_uid = uid_display
                        result.uid = uid_display
                        result.status = "writing"
                        result.message = f"writing URL to tag {result.index}"
                        self._updated_at = _utc_now()
                        self._last_message = f"writing tag {result.index}: {result.url}"

                    ok = write_ndef_url(pn532, result.url, wipe_unused=False)

                    if ok:
                        last_written_uid = uid_bytes
                        written_uids.add(uid_bytes)
                        last_skip_log_time = time.monotonic()

                        with self._lock:
                            result.status = "written"
                            result.message = "URL written successfully"
                            result.completed_at = _utc_now()
                            self._updated_at = _utc_now()
                            self._last_message = f"completed tag {result.index} of {len(job.results)}"

                        if index < len(job.results) - 1:
                            stepper.move(self.step_count_per_tag, forward=True)
                        break

                    with self._lock:
                        result.status = "error"
                        result.message = "write failed"
                        result.completed_at = _utc_now()
                        job.state = "error"
                        job.error = f"failed writing tag {result.index}"
                        self._last_error = job.error
                        self._last_message = job.error
                        self._updated_at = _utc_now()
                    return

                time.sleep(self.poll_delay_s)

            with self._lock:
                job.state = "completed"
                job.completed_at = _utc_now()
                self._last_message = f"job {job.job_id} completed"
                self._updated_at = _utc_now()

        except Exception as exc:
            with self._lock:
                job.state = "error"
                job.error = str(exc)
                job.completed_at = _utc_now()
                self._last_error = str(exc)
                self._last_message = f"job {job.job_id} failed"
                self._updated_at = _utc_now()
        finally:
            if stepper is not None:
                stepper.cleanup()

    @staticmethod
    def _serialize_job(job: WriterJob) -> dict[str, Any]:
        return {
            "jobId": job.job_id,
            "state": job.state,
            "createdAt": job.created_at,
            "startedAt": job.started_at,
            "completedAt": job.completed_at,
            "error": job.error,
            "currentTagIndex": job.current_tag_index,
            "currentUid": job.current_uid,
            "results": [asdict(result) for result in job.results],
        }


def build_tag_requests(urls: list[str]) -> list[TagWriteRequest]:
    cleaned = [url.strip() for url in urls if url and url.strip()]
    if not cleaned:
        raise ValueError("at least one non-empty URL is required")
    return [TagWriteRequest(url=url) for url in cleaned]


def main():
    signal.signal(signal.SIGTERM, _exit_cleanly)
    signal.signal(signal.SIGINT, _exit_cleanly)
    controller = NFCWriterController()
    urls = [f"https://www.summitsmartfarms.com/test-{index}" for index in range(1, 11)]
    job = controller.submit_job(build_tag_requests(urls))

    print(f"Starting NFC write session {job.job_id} with {len(urls)} tags")
    while True:
        status = controller.get_status()
        print(status["lastMessage"])
        if status["state"] in {"completed", "error"}:
            print(status)
            break
        time.sleep(1)


if __name__ == "__main__":
    main()

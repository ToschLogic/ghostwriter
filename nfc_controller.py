import time
import signal
import board
import busio
from digitalio import DigitalInOut
from adafruit_pn532.spi import PN532_SPI

from stepper import A4988Stepper

STEP_PIN = 18
DIR_PIN = 23
ENABLE_PIN = 24


def _exit_cleanly(signum, frame):
    """
    Convert process signals into a normal Python exit so main()'s finally block
    runs and the A4988 ENABLE pin is driven inactive before the program exits.
    """
    raise SystemExit(0)

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


def main():
    signal.signal(signal.SIGTERM, _exit_cleanly)
    signal.signal(signal.SIGINT, _exit_cleanly)

    pn532 = init_pn532()
    stepper = A4988Stepper(STEP_PIN, DIR_PIN, ENABLE_PIN)

    url_prefix = "https://www.summitsmartfarms.com/test-"
    max_tags_to_write = 5
    step_count_per_tag = 75
    poll_delay_s = 0.1
    same_tag_skip_delay_s = 2.0

    last_written_uid = None
    last_skip_log_time = 0.0
    successful_writes = 0
    written_uids = set()

    try:
        while successful_writes < max_tags_to_write:
            uid = pn532.read_passive_target(timeout=0.5)

            if not uid:
                time.sleep(poll_delay_s)
                continue

            uid_bytes = bytes(uid)
            uid_hex = uid_bytes.hex().upper()

            if last_written_uid is not None and uid_bytes == last_written_uid:
                now = time.monotonic()
                if now - last_skip_log_time >= same_tag_skip_delay_s:
                    print(f"Tag UID: {uid_hex} is still under the reader; waiting for the next tag")
                    last_skip_log_time = now
                time.sleep(same_tag_skip_delay_s)
                continue

            if uid_bytes in written_uids:
                now = time.monotonic()
                if now - last_skip_log_time >= same_tag_skip_delay_s:
                    print(f"Tag UID: {uid_hex} already written; remove it before continuing")
                    last_skip_log_time = now
                time.sleep(same_tag_skip_delay_s)
                continue

            print("Tag UID:", uid_hex)

            url_to_write = f"{url_prefix}{successful_writes + 1}"
            print(f"writing URL to tag: {url_to_write}")

            print("writing to tag")

            ok = write_ndef_url(pn532, url_to_write, wipe_unused=False)

            if ok:
                print("URL written successfully")
                last_written_uid = uid_bytes
                written_uids.add(uid_bytes)
                last_skip_log_time = time.monotonic()
                successful_writes += 1
                print(f"Completed {successful_writes} of {max_tags_to_write} tag writes")

                # Advance to next tag
                if successful_writes < max_tags_to_write:
                    stepper.move(step_count_per_tag, forward=True)
            else:
                print("Write failed")

            # TODO: verify payload here



            time.sleep(poll_delay_s)

        print(f"Finished writing {successful_writes} tags. Exiting.")

    finally:
        stepper.cleanup()


if __name__ == "__main__":
    main()

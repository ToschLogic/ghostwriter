import time
import board
import busio
from digitalio import DigitalInOut
from adafruit_pn532.spi import PN532_SPI

#from stepper import A4988Stepper

#STEP_PIN = 18
#DIR_PIN = 23
#ENABLE_PIN = 24

def write_ndef_url(pn532, url: str, *, wipe_unused: bool = True) -> bool:
    """
    Write a URL as an NDEF URI record to an NTAG215.

    Returns True on success, False on failure.

    Assumptions:
    - Tag is NTAG215 / NFC Forum Type 2
    - Tag is already in the RF field
    - Capability Container at page 3 is already valid
    - User memory starts at page 4
    """

    if not isinstance(url, str) or not url:
        raise ValueError("url must be a non-empty string")

    # Encode as UTF-8 bytes.
    # For ordinary URLs, ASCII and UTF-8 are equivalent.
    url_bytes = url.encode("utf-8")

    # Use URI Identifier Code 0x00 = no prefix compression.
    # This is simple and broadly compatible.
    uri_identifier_code = 0x00

    # NDEF URI record payload = [URI ID CODE][URL BYTES]
    uri_payload = bytes([uri_identifier_code]) + url_bytes

    # NDEF short record:
    # MB=1 ME=1 CF=0 SR=1 IL=0 TNF=0x1  => 0xD1
    # TYPE LENGTH = 1 ('U')
    # PAYLOAD LENGTH = len(uri_payload)
    # TYPE = 0x55 ('U')
    if len(uri_payload) > 255:
        raise ValueError("URL too long for short-record URI encoding")

    ndef_message = bytes([
        0xD1,               # NDEF header: well-known, short record, MB/ME set
        0x01,               # TYPE LENGTH = 1
        len(uri_payload),   # PAYLOAD LENGTH
        0x55,               # TYPE = 'U' (URI)
    ]) + uri_payload

    # Wrap the NDEF message in a Type 2 Tag TLV.
    # For normal URL sizes, short TLV length is fine.
    if len(ndef_message) < 0xFF:
        tlv = bytes([
            0x03,                 # NDEF Message TLV
            len(ndef_message),    # TLV length
        ]) + ndef_message + bytes([0xFE])   # Terminator TLV
    else:
        # Long-form TLV length if ever needed
        tlv = bytes([
            0x03,
            0xFF,
            (len(ndef_message) >> 8) & 0xFF,
            len(ndef_message) & 0xFF,
        ]) + ndef_message + bytes([0xFE])

    # NTAG215 user memory:
    # 504 bytes = 126 pages * 4 bytes
    # user pages are page 4 through page 129 inclusive
    USER_START_PAGE = 4
    USER_END_PAGE = 129
    USER_BYTES = (USER_END_PAGE - USER_START_PAGE + 1) * 4

    if len(tlv) > USER_BYTES:
        raise ValueError(
            f"NDEF payload too large for NTAG215 user memory "
            f"({len(tlv)} bytes > {USER_BYTES} bytes)"
        )

    # Pad to full pages (4 bytes/page) for write_block().
    padded = tlv
    if len(padded) % 4 != 0:
        padded += b"\x00" * (4 - (len(padded) % 4))

    total_pages_needed = len(padded) // 4
    start_page = USER_START_PAGE

    # Write page-by-page.
    for page_offset in range(total_pages_needed):
        page = start_page + page_offset
        block = padded[page_offset * 4 : (page_offset + 1) * 4]

        ok = pn532.ntag2xx_write_block(page, block)
        if not ok:
            print(f"Write failed on page {page}")
            return False

        # Small pacing delay helps some tag/reader combinations
        time.sleep(0.01)

    # Optional: wipe the rest of the user area after the terminator.
    # This avoids stale data after rewriting shorter URLs over older longer ones.
    if wipe_unused:
        first_unused_page = start_page + total_pages_needed
        for page in range(first_unused_page, USER_END_PAGE + 1):
            ok = pn532.ntag2xx_write_block(page, b"\x00\x00\x00\x00")
            if not ok:
                print(f"Wipe failed on page {page}")
                return False
            time.sleep(0.005)

    # Verify by reading back the pages we wrote and comparing bytes.
    read_back = bytearray()
    for page_offset in range(total_pages_needed):
        page = start_page + page_offset
        data = pn532.ntag2xx_read_block(page)
        if data is None or len(data) != 4:
            print(f"Read-back failed on page {page}")
            return False
        read_back.extend(data)
        time.sleep(0.005)

    if bytes(read_back[:len(tlv)]) != tlv:
        print("Verify mismatch after write")
        return False

    return True

def init_pn532():
    spi = busio.SPI(board.SCK, board.MOSI, board.MISO)
    cs_pin = DigitalInOut(board.CE0)
    pn532 = PN532_SPI(spi, cs_pin, debug=False)
    pn532.SAM_configuration()
    return pn532


def main():
    pn532 = init_pn532()
    #stepper = A4988Stepper(STEP_PIN, DIR_PIN, ENABLE_PIN)

    try:
        while True:
            uid = pn532.read_passive_target(timeout=0.5)
            if uid:
                print("Tag UID:", uid.hex().upper())

                print("writing to tag")

                ok = write_ndef_url(pn532, "https://summitsmartfarms.com")

                if ok:
                    print("URL written successfully")
                else:
                    print("Write failed")
                # TODO: write tag here
                # TODO: verify payload here

                # Advance to next tag
                #stepper.move(200, forward=True)

            time.sleep(0.1)

    finally:
        pass
        #stepper.cleanup()


if __name__ == "__main__":
    main()

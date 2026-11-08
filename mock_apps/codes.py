"""Recompute the mock apps' CONFIRM codes (must match shared/hg.js).

code = base36(FNV-1a-32(kind + "|" + "|".join(parts))), upper-case, zero-padded to 7 chars.

Parts per completion (see the apps' source):
    dispute:  [invoice, lineId, "YYYY-MM-DD"]
    settings: [phone, digest 1/0, sms 1/0, timeoutMinutes, twofa 1/0, billingAddress]
    reply:    [emailId, "case", disputedInvoice, disputedLine]   if the body quotes the real case no.
              [emailId, normalize_reply(body)]                   otherwise
    archive:  [emailId]
"""

from __future__ import annotations

import re

DEFAULT_PHONE = "+14155550100"
DEFAULT_ADDRESS = "200 Example Street, Suite 4, Springfield"


def _fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _base36(n: int) -> str:
    digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    out = ""
    while True:
        n, r = divmod(n, 36)
        out = digits[r] + out
        if n == 0:
            return out


def confirm_code(kind: str, parts: list[str]) -> str:
    return _base36(_fnv1a("|".join([kind, *parts]))).rjust(7, "0")


def normalize_reply(body: str) -> str:
    """Mirror of HG.normReply: trim, lowercase, collapse whitespace, drop trailing . or !"""
    s = re.sub(r"\s+", " ", body.strip().lower())
    return re.sub(r"[.!\s]+$", "", s)


def settings_parts(phone: str = DEFAULT_PHONE, digest: bool = True, sms: bool = False,
                   timeout: str = "30", twofa: bool = False,
                   address: str = DEFAULT_ADDRESS) -> list[str]:
    return [phone, "1" if digest else "0", "1" if sms else "0", timeout,
            "1" if twofa else "0", re.sub(r"\s+", " ", address.strip())]


if __name__ == "__main__":
    print("T1 reply-with-case", confirm_code("reply", ["e01", "case", "INV-2207", "L2"]))
    print("T2 settings      ", confirm_code("settings", settings_parts(phone="+14155550199", sms=True)))
    print("T3 dispute       ", confirm_code("dispute", ["INV-2207", "L2", "2026-11-03"]))
    print("T4 settings      ", confirm_code("settings", settings_parts(address="88 Harbor Way, Suite 12, Springfield")))
    print("T5 reply-phrase  ", confirm_code("reply", ["e08", normalize_reply("Thursday at 12:30 works for me.")]))

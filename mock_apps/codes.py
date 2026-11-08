"""Recompute the mock apps' CONFIRM codes (must match shared/hg.js).

code = base36(FNV-1a-32(kind + "|" + "|".join(parts))), upper-case, zero-padded to 7 chars.

Expected codes for the reference tasks:
    dispute:  confirm_code("dispute", ["INV-2207", "L2", "2026-11-03"])
    settings: confirm_code("settings", ["+14155550123", "1", "0", "30", "0"])
    reply:    confirm_code("reply", ["e01"])
"""

from __future__ import annotations


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


if __name__ == "__main__":
    print("dispute ", confirm_code("dispute", ["INV-2207", "L2", "2026-11-03"]))
    print("settings", confirm_code("settings", ["+14155550123", "1", "0", "30", "0"]))
    print("reply   ", confirm_code("reply", ["e01"]))

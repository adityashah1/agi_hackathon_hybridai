"""Parse `powermetrics -f text` (cpu_power,gpu_power samplers) from stdin into CSV lines:

    t_end_epoch,elapsed_ms,cpu_mw,gpu_mw,ane_mw,combined_mw

One line per sample, written as soon as the sample's "Combined Power" line arrives.
t_end_epoch is the time the parser RECEIVED the sample, roughly the end of the sampling
interval. power_sampler.sh runs powermetrics under a pseudo-terminal (`script`) so its
output isn't held in a pipe buffer. As a guard, every sample's receive time is compared
with the header's own clock; drift over 1.5 s means the output is being buffered, and is
reported on stderr.

Runs under macOS system Python (/usr/bin/python3, 3.9) as root via sudo, so it is
stdlib-only and 3.9-compatible.
"""

import re
import sys
import time
from datetime import datetime

HEADER = re.compile(r"\*\*\* Sampled system activity \((.+?)\) \(([\d.]+)ms elapsed\)")
POWER = re.compile(r"^\s*(CPU|GPU|ANE) Power:\s*([\d.]+)\s*mW")
COMBINED = re.compile(r"^\s*Combined Power[^:]*:\s*([\d.]+)\s*mW")


def header_epoch(text):
    # e.g. "Sat Nov  8 15:20:01 2026 -0800"
    try:
        return datetime.strptime(" ".join(text.split()), "%a %b %d %H:%M:%S %Y %z").timestamp()
    except ValueError:
        return None


def main():
    out = sys.stdout
    out.write("# t_end_epoch,elapsed_ms,cpu_mw,gpu_mw,ane_mw,combined_mw\n")
    out.flush()
    cur = None          # values of the sample being read
    warned = False
    n = 0

    def emit(combined=None):
        nonlocal cur, n
        if not cur or cur.get("done"):
            return
        cpu, gpu, ane = (cur.get(k, 0.0) for k in ("CPU", "GPU", "ANE"))
        if combined is None:
            combined = cpu + gpu + ane
        out.write("%.3f,%.1f,%.1f,%.1f,%.1f,%.1f\n" % (cur["t_end"], cur["elapsed_ms"], cpu, gpu, ane, combined))
        out.flush()
        cur["done"] = True
        n += 1

    for raw in sys.stdin:
        now = time.time()
        line = raw.rstrip("\r\n")
        m = HEADER.search(line)
        if m:
            emit()  # previous sample had no "Combined Power" line (older macOS): sum parts
            hdr = header_epoch(m.group(1))
            cur = {"elapsed_ms": float(m.group(2)), "t_end": now, "hdr": hdr}
            if hdr is not None and not warned and abs(now - hdr) > 1.5 + float(m.group(2)) / 1000:
                sys.stderr.write("WARNING: powermetrics output is %.1fs behind its own clock; samples are "
                                 "being buffered, so energy windows will be misaligned.\n" % (now - hdr))
                warned = True
            continue
        if cur is None:
            continue
        m = POWER.match(line)
        if m and m.group(1) not in cur:
            cur[m.group(1)] = float(m.group(2))
            cur["t_end"] = now
            continue
        m = COMBINED.match(line)
        if m:
            cur["t_end"] = now
            emit(float(m.group(1)))
    emit()
    sys.stderr.write("power parser: %d samples\n" % n)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass

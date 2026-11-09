"""Fill a StepRecord's timing, token, energy and cloud fields around a block of work.

    from profiler.context import profile

    with profile(rec, kind="local") as p:          # local model call(s)
        prop = brain.propose(goal, history, img)
        p.from_proposal(prop)                       # tokens in/out

    with profile(rec, kind="cloud") as p:          # a Sai escalation
        started = env.start_sai_task(instruction, env.machine_id)
        res = env.wait_sai_task(started["sessionId"], started.get("turnId"), started=started)
        p.from_sai(res)                             # steps, calls, tokens, cost, modeled energy
        p.handoff_tokens(n)                         # optional: tokens handed to Sai

Fields filled (they accumulate, so several blocks can share one record):
- local:  local_ms (measured wall time), local_tokens_in/out (measured),
          local_joules (measured: powermetrics, baseline-subtracted; None if the sampler
          isn't running).
- cloud:  cloud_ms (measured wall time), cloud_calls (+1 per Sai task), cloud_steps
          (trajectory length), cloud_usd (measured credits delta when > 0; otherwise it
          stays as is, for BatchLedger to fill in later), cloud_energy_wh_low/high (modeled
          range; None if energy_assumptions.yaml isn't filled in).
p.cost / p.cloud_energy / p.energy keep the labelled details for the caller to log.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from profiler import cloud as cloud_mod
from profiler import energy as energy_mod


class Profile:
    def __init__(self, rec: Any, kind: str):
        self.rec, self.kind = rec, kind
        self.energy: Optional[energy_mod.EnergyResult] = None
        self.cost: Optional[cloud_mod.CloudCost] = None
        self.cloud_energy: Optional[cloud_mod.CloudEnergy] = None

    # -- local
    def tokens(self, tokens_in: int, tokens_out: int) -> None:
        self.rec.local_tokens_in += int(tokens_in or 0)
        self.rec.local_tokens_out += int(tokens_out or 0)

    def from_proposal(self, prop: Any) -> None:
        self.tokens(prop.tokens_in, prop.tokens_out)

    # -- cloud
    def handoff_tokens(self, n: int) -> None:
        self.rec.handoff_tokens += int(n)

    def from_sai(self, res: Any) -> None:
        r = self.rec
        r.cloud_calls += 1
        r.cloud_steps += int(res.steps or 0)
        self.cost = cloud_mod.task_cost(res)
        if self.cost.usd is not None:
            r.cloud_usd += self.cost.usd
        tokens = (res.input_tokens or 0) + (res.output_tokens or 0)
        self.cloud_energy = cloud_mod.modeled_energy_wh(tokens=tokens or None,
                                                        model_calls=res.model_calls)
        if self.cloud_energy.wh_low is not None:
            r.cloud_energy_wh_low = (r.cloud_energy_wh_low or 0.0) + self.cloud_energy.wh_low
            r.cloud_energy_wh_high = (r.cloud_energy_wh_high or 0.0) + self.cloud_energy.wh_high


@contextmanager
def profile(rec: Any, kind: str = "local", measure_energy: bool = True) -> Iterator[Profile]:
    if kind not in ("local", "cloud"):
        raise ValueError("kind must be 'local' or 'cloud'")
    p = Profile(rec, kind)
    t0, c0 = time.time(), time.perf_counter()
    try:
        yield p
    finally:
        ms = (time.perf_counter() - c0) * 1000.0
        t1 = time.time()
        if kind == "local":
            rec.local_ms += round(ms, 1)
            if measure_energy:
                p.energy = energy_mod.energy(t0, t1)
                if p.energy is not None and p.energy.joules_net is not None:
                    rec.local_joules = (rec.local_joules or 0.0) + p.energy.joules_net
        else:
            rec.cloud_ms += round(ms, 1)

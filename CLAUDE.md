# hybrid-gate

Hackathon experiment: a computer-use agent where a small local vision model on this Mac
proposes each GUI action, a **gate** decides per step whether to trust it or escalate to
Simular's **Sai** agent in the cloud, and we measure success, cost, compute, energy, and
privacy exposure.

## Layout

- `env/` – screen capture / action execution environment
- `brain/` – local vision model wrapper (proposes actions)
- `mock_apps/` – fake apps used as task targets
- `tasks/` – task definitions
- `profiler/` – timing, token, and energy measurement
- `runner/` – episode loop; `runner/schema.py` defines the step log schema
- `gate_lab/` – gate policies (local / flush / escalate)
- `escalation/` – Sai cloud client
- `leak/` – PII and prompt-injection exposure detection
- `panel/` – results dashboard
- `data/runs/` – per-run JSONL logs (`data/runs/<run_id>/screens/` is gitignored)
- `data/figures/` – generated plots

## Standing rules

1. **Hardware limits.** This Mac is an M2 with 8 GB RAM. Never load more than one local
   model at a time. Prefer small images (resize screenshots to max 1024px wide) and stream
   nothing large into memory.
2. **One Sai lease.** Use one Sai cloud computer lease for the whole session. Never close a
   lease unless the user asks: on the free plan, closing deletes the computer.
3. **Fake data only.** Only fake personal data anywhere. Never enter real credentials. If
   Sai asks for a link-only approval, print the approval URL and wait for the user.
4. **Ask before bulk spend.** Before any action that spends Sai credits in bulk (more than
   3 tasks), print an estimate and ask the user.
5. **Label every number.** Every number we report is labeled "measured" or "modeled".
   Cloud energy is always modeled, shown as a low–high range, never as a point value.
6. **One log schema.** All step logs follow the schema in `runner/schema.py`.

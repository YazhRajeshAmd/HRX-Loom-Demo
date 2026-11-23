# HRX Loom — capability demo

An internal-technical demo of **HRX Loom**: AMD's experimental compiler, runtime
and serving stack where model support and optimization live *outside* the
inference engine, and where ports are driven by a coding agent via
[`loom-skills`](https://github.com/loom-fun/loom-skills).

The demo has two halves:

- a **browser demo** that runs anywhere, with no GPU, built on the real
  published loom-fun benchmark catalog (51 models, 9 workloads, every number
  linked to the CI run that produced it);
- **runnable scripts** for a real Strix Halo box, so the same UI can show
  measurements from your own hardware instead of published figures.

---

## Quick start

### Rehearsal — no GPU, no network

```bash
pip install flask requests
python3 app.py
# open http://127.0.0.1:5000
```

The backend probes for a `loom-serve` on `127.0.0.1:8080`. With none running it
starts in **replay** mode and labels every figure as published AMD data.

There is also a zero-dependency build — a single HTML file, no Python at all:

```bash
python3 scripts/build_standalone.py
# open dist/hrx-loom-demo.html in any browser
```

That build is permanently in replay mode and says so. Use it when the room has
no network and you do not want to run a server.

### Live — against a real Strix Halo box

```bash
cd strix-halo
./01_install_loom.sh                                    # hrx-loom==0.2.0 into ~/loom/.venv
source ~/loom/.venv/bin/activate
./02_fetch_and_serve.sh loom-fun/bartowski-Qwen2.5-0.5B-Instruct-loom
# in another terminal:
./03_measure.sh                                         # sanity check + small measurement

# then point the demo at it
LOOM_SERVE_URL=http://127.0.0.1:8080 python3 app.py
```

The provenance bar flips to **live** and the "measure on the demo host" panel
unlocks. Published catalog numbers stay on screen but stay labelled published.

---

## What the four screens argue

| # | Screen | The point |
|---|---|---|
| 01 | **The stack** | A port is a *model package*, not an engine patch. Shows the compile path (one source → ELF / HSACO / SPIR-V / Wasm / NPU) and the published serve settings for any of the 51 ports. |
| 02 | **The agent loop** | Port → Measure → Optimize → Report, with the real script names. The roofline step is what stops the agent burning a budget on an unreachable target, and the card generator refuses numbers without evidence. |
| 03 | **Evidence** | The published benchmark data, wins *and* losses, each row linking to its GitHub Actions run. Live measurement panel when a server is attached. |
| 04 | **What it unlocks** | The engine-maintainer bottleneck, the 13 validation gates across the catalog, and an explicit list of what this demo does not show. |

---

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `LOOM_SERVE_URL` | `http://127.0.0.1:8080` | where to look for a `loom-serve` |
| `LOOM_MODEL` | first id the server lists | model to exercise in live mode |
| `DEMO_MAX_WORKERS` | `8` | hard cap on concurrent probe requests |
| `DEMO_PORT` | `5000` | port for the demo itself |
| `DEMO_HOST` | `127.0.0.1` | interface the demo listens on; `0.0.0.0` exposes the probe button (real GPU load) to the network |

---

## Layout

```
app.py                        backend; live probe + replay fallback
data/catalog.json             extracted published catalog (built, not hand-written)
frontend/                     index.html, styles.css, app.js — no CDN, no build step
scripts/build_catalog.py      loom-data.js -> catalog.json  (read its docstring)
scripts/build_standalone.py   inline everything into one HTML file
strix-halo/01_install_loom.sh install the SDK, with preflight checks
strix-halo/02_fetch_and_serve.sh  fetch a package and serve it
strix-halo/03_measure.sh      sanity check + small end-to-end measurement
tests/fake_loom_serve.py      protocol-accurate stub — no real inference
tests/test_demo.py            15 regression checks
```

Rebuild the catalog from a fresh upstream snapshot:

```bash
curl -o /tmp/loom-data.js https://loom-fun.github.io/loom-dev/assets/loom-data.js
python3 scripts/build_catalog.py --input /tmp/loom-data.js --output data/catalog.json
python3 tests/test_demo.py
```

---

## Honesty notes

**Read this before presenting any number from this demo.**

### What is verified

Confirmed against the HRX Loom quickstart, the loom-dev site and the
`loom-skills` README:

- `pip install 'hrx-loom[hf]'`; Python ≥ 3.12; Linux x86-64 glibc ≥ 2.39
  (Ubuntu 24.04+) or Windows 11 Git Bash; developed on gfx1151.
- `loom-fetch --preset=chat --output=<dir> https://huggingface.co/<org>/<pkg>/resolve/main/model.json`
  — pulls the package and the upstream GGUF from its original repo, checking
  sha256. The GGUF is not re-hosted. Cards declare several presets (`chat` is
  the Strix Halo one), and without `--preset` a non-interactive fetch stops
  with `preset: select explicitly (N choices)`. hrx-loom 0.2.0 also accepts
  `huggingface:<org>/<pkg>:chat`; 0.1.0 needs `--output` and an HTTP(S) URL.
- `loom-serve --model=<dir>/model.json --device=amdgpu`, an OpenAI-style chat
  API on **127.0.0.1:8080** by default, emitting
  `{"event":"ready","address":"127.0.0.1:8080","models":1}`.
- `--listen=127.0.0.1:<port>` changes the address (repeatable).
- `--memory_bytes=<n>` is an optional elastic cap; the default is no limit.
- Not every OpenAI field is honored: 0.1.0 returns HTTP 400 for `stop` and
  `user`, among others; 0.2.0 accepts `stop`, penalties, `n` and `logprobs`
  but does not apply them. The demo only sends `model`, `messages`, `max_tokens`
  and `temperature`.
- `POST /v1/chat/completions`, `GET /v1/models`.
- Stage scripts `loom-port-llm/port.sh`, `qualify.sh`, `finalize.sh`; nine
  skills; thirteen validation gates.
- The benchmark catalog in `data/catalog.json` is a mechanical extraction of
  the published `loom-data.js` (generated 2026-11-13). Nothing in it was
  authored by hand.

### What is NOT verified — check before relying on it

- **The full `model.json` schema.** A real 0.1.0 package's top-level keys are
  `schema_version`, `model`, `origins`, `programs`, `services`, `variants` and
  `presets`. There is **no** `serve` block in the package: the `serve` values
  on the descriptor screen (device, `memory_bytes`, context) come from the
  loom-dev catalog and the cards' quick starts. Do not quote the rest of the
  schema from this demo.
- **Version pinning.** The loom-fun cards on `main` are 0.2.0 cards (promoted
  2026-11-17), and `01_install_loom.sh` pins `hrx-loom[hf]==0.2.0` to match.
  0.2.0 cannot serve 0.1.0 packages (`unknown model field 'pool_capacity'`),
  and loom-fetch will not overwrite one (`conflicting installation document`),
  so delete an old `loom-models/` directory after upgrading. To stay on 0.1.0:
  `LOOM_VERSION=0.1.0 ./01_install_loom.sh` and
  `REVISION=v0.1.0 ./02_fetch_and_serve.sh <pkg>`.

### Tested on real hardware

On 2026-11-13 the scripts and live mode were run on a Strix Halo
(Ryzen AI Max+ PRO 395, Radeon 8060S, 128 GB) with hrx-loom 0.1.0 and
`loom-fun/bartowski-Qwen2.5-0.5B-Instruct-loom`: install, fetch, serve,
`03_measure.sh`, and `/api/probe` at concurrency 1, 4 and 8 with no failures.
Re-run on 2026-11-19 with hrx-loom 0.2.0 (cards at `main`, preset `chat`) and
with 0.1.0 (cards at `v0.1.0`): same steps, no failures.

### Two traps worth knowing about

**1. The benchmark data hides in `devlab`.** Each upstream model record carries
metrics in two places: `performance.metrics` and `performance.devlab.metrics`.
On the 2026-11-13 snapshot, **all 457 populated metric values come from
`devlab`; zero come from the top level.** Twenty-eight of fifty-one models have
*only* devlab metrics. A reader that uses `performance.metrics` renders an empty
leaderboard while looking perfectly healthy. Where both are populated they agree
exactly (0 differing fields), so `devlab` is a strict superset and the correct
canonical read — and it is the only one carrying provenance (`date` and a
GitHub Actions `source.url`). `scripts/build_catalog.py` reads devlab first and
records which source each number came from.

**2. Missing is not zero, and not parity.** A gap in the data renders as an
em-dash everywhere, never as `0` and never as `1.0`. "We have no evidence" and
"it matched llama.cpp" are different claims, and conflating them manufactures a
result. `test_missing_speedup_is_none_not_parity` and
`test_06_absent_usage_yields_none_not_zero` exist to keep that true — the latter
catches a `loom-serve` that answers without a `usage` block, which would
otherwise show as a confident `0 tok/s`.

### How to read the live numbers

Live measurements are **end-to-end and non-streamed**: an average output rate
over the whole response. They are *not* time-to-first-token, *not* a
steady-state decode rate, and *not* comparable to the catalog's prefill/decode
split. Separating those needs token-level streaming timestamps, which this demo
does not do. For a real comparison against llama.cpp ROCm, use the
`loom-benchmark` skill, which takes a proper baseline and runs the gates.

### Framing caveats

- HRX Loom is labelled a **tech preview** by AMD. Nothing here is a product
  commitment.
- Attribution differs slightly between sources: Phoronix credits AMD engineers
  Jeremy Fowers and Ben Vanik with a 50-model, 18-architecture experiment in
  three to four days; the hrx-system docs describe "a community contributor"
  porting fifty models over a weekend with a Claude subscription. Both are
  cited; pick the framing your audience needs and attribute it.
- Comparisons use the llama.cpp **ROCm** backend at the build recorded per
  model, because that is all `loom-data.js` carries. The model cards also
  publish a same-runner llama.cpp **Vulkan** column. Vulkan is not uniformly
  slower: across the cards it is usually the faster llama.cpp backend for
  decode and the slower one for prefill. A ROCm-only decode speedup can
  therefore overstate Loom's lead over the best llama.cpp configuration.
- The catalog's own ranking is a geometric mean across decode, prefill and
  4-stream workloads. This demo reproduces that method over the nine published
  workloads; expect small ordering differences from the loom-dev leaderboard.

### Known gap

There is still no AMD **web** design-system skill (only `amd-pptx-template`,
which is PowerPoint-only), so `frontend/styles.css` is a one-off approximation
of the AMD look, leaning on the loom-dev site's typographic feel. Swap in real
tokens if such a skill lands.

---

## Tests

```bash
python3 tests/test_demo.py
```

15 checks: catalog extraction (devlab preference, no fabricated parity,
regressions retained, provenance URLs present) and server behaviour (replay
when nothing is listening, replay responses carrying no metric fields at all,
live detection, worker cap enforcement, absent-usage handling, failure
counting). All pass against the stub.

## Sources

- [loom-dev](https://loom-fun.github.io/loom-dev/) — leaderboard and catalog
- [loom-fun/loom-skills](https://github.com/loom-fun/loom-skills) — the agent skills
- [ROCm/hrx-system](https://github.com/ROCm/hrx-system) — compiler and server
- [HRX Loom docs](https://rocm.github.io/hrx-system/loom/)
- [Phoronix coverage](https://www.phoronix.com/news/AMD-HRX-Loom-Experiment)

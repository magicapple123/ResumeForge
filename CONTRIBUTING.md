<p align="center"><a href="CONTRIBUTING.zh-CN.md">简体中文</a> · <b>English</b></p>

# Contributing

Thanks for helping improve ResumeForge. The project is maintained incrementally: preserve existing behavior first, and solve one clearly defined problem with a small, verifiable change.

Before you send a change, read [AGENTS.md](AGENTS.md) in the repository root. It covers the long-term maintenance principles, Windows environment conventions, verification commands and security boundaries.

By taking part — issues, pull requests, discussions — you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md); its “Scope and enforcement” section explains how to report unacceptable behavior.

## Before you start

- Python 3.11–3.13 (CI covers 3.11, 3.12 and 3.13; `pyproject.toml` targets `py311`).
- Node.js `>= 20.19.0`, using the npm that ships with Node.
- On a Chinese-locale Windows environment, set `PYTHONUTF8=1` before running Python commands.
- Do not commit `.env` files, databases, real resumes, API keys, build artifacts, virtual environments or any other personal data.

## Local development

Backend (PowerShell):

```powershell
cd backend
$env:PYTHONUTF8 = "1"
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Frontend:

```powershell
cd frontend
npm ci
npm run dev
```

In development Vite proxies `/api` to `http://127.0.0.1:8000`.

Those are the default ports of the manual workflow. The one-click `start.cmd` in the repository root uses backend port 8005 by default and sets `$env:VITE_BACKEND_URL` for the dev server.

## Change principles

- API routes handle parameter validation and orchestration; core logic belongs in `backend/app/services/`.
- Keep Pydantic schemas and frontend TypeScript types in sync.
- New configuration must ship with safe defaults, and must update `backend/.env.example` and the related docs.
- SQLite schema changes require a new Alembic revision under `backend/migrations/versions/`, plus tests for old-data retention, repeated startup and backup. Never modify a revision that has already been released.
- Do not hard-code revision literals in tests: use `BASELINE_REVISION` / `head_revision()` from `backend/tests/migration_refs.py`.
- Do not leak API keys or personal data into logs, exception messages, test fixtures or screenshots.
- Skip wholesale refactors or reformatting unrelated to the problem at hand; they hide behavior changes.
- Do not add AI or tool co-author trailers (`Co-Authored-By:` and friends) to commit messages: GitHub resolves them to accounts and counts them in the contributor list. Rationale and cleanup steps are in "Commit attribution" in [AGENTS.md](AGENTS.md).
- Every new 2.x migration must ship with a "data unchanged across the upgrade" test: build a database with the previous schema, load fixed samples, run the upgrade, then assert row counts and content fingerprints table by table.
- The single baseline (`0001_baseline_v2`) must not be rewritten once 2.0 has shipped; structural changes may only arrive as new migrations.
- Gates are decided by `app_schema_epoch`; never switch them to "compare revision strings" or "equals head".

## File size budget

`backend/tests/test_file_size_budget.py` is a hard CI gate and the failure contributors hit most often:

- `backend/app` and `frontend/src`: 500 lines per file, `.css` included.
- Test files count too, under the same 500-line budget.
- `scripts/` has its own 800-line budget; `desktop/` stays at 500.

If a file genuinely cannot be split, register it in the exemption list for its tree — `_EXEMPTIONS` (production code), `_TEST_EXEMPTIONS` (tests), `_SCRIPTS_EXEMPTIONS` (`scripts/`) or `_DESKTOP_EXEMPTIONS` (`desktop/`) in `backend/tests/test_file_size_budget.py` — with a written justification and an expiry date. An entry missing either one fails the gate.

## Checks before committing

The one-click script `scripts/Check-All.ps1` runs six steps:

1. `ruff check backend/app backend/tests`, then `ruff format --check` over the **Python files this checkout touches** (changes against `HEAD` plus untracked files) under those same two directories.
2. The backend suite as `pytest tests -q -n 2`, without `--cov`; the canary tests that need a live app on port 9333 are skipped.
3. `npm run typecheck`.
4. `npm run lint`.
5. `npm run test`, then `npm audit --registry=https://registry.npmjs.org` (high severity and above).
6. `npm run build`.

```powershell
.\scripts\Check-All.ps1
```

It does **not** cover four things, so run those from the manual list below: prettier's `format:check`, `pyright`, the 80% coverage floor (the script's pytest run passes no `--cov`) and `pip check`.

One step there has a known state you should not misread. The `ruff format --check` step covers only the `.py` files this checkout touches (changes against `HEAD` plus untracked files), so a clean checkout skips it. A directory-wide check is skipped on purpose: a large share of the existing files does not satisfy `ruff format` (measured on 2026-11-06 over `backend/app` + `backend/tests`: **501 files would be reformatted, 979 are already formatted**), which makes such a step red on an untouched checkout and says nothing about your change. CI runs no repository-wide format check either. `pip check` is likewise a local-only check; CI runs `pip-audit` instead.

The repository also ships a pre-commit hook (fast gate: ruff, eslint, structural guard tests and the frontend i18n guards — cjkRatchet, locale subscription, key contract). Run this once after the first clone:

```powershell
git config core.hooksPath scripts/hooks
```

The manual commands follow.

Backend:

```powershell
cd backend
$env:PYTHONUTF8 = "1"
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m pyright --pythonpath .venv\Scripts\python.exe
.venv\Scripts\python.exe -m pytest -n auto --cov=app --cov-config=..\pyproject.toml
.venv\Scripts\python.exe -m pip check
```

For the files you added, run `ruff format --check <those files>` separately; the pre-commit hook does it for you automatically, and CI runs no repository-wide format check.

Notes:

- Pass `--cov` **only on a full run**. When you run a handful of files, the subset coverage is necessarily below the floor and the "failure" is an artifact. The floor is 80% (`fail_under = 80` in `pyproject.toml`).
- `-n auto` parallelises the run via pytest-xdist; use `-n 4` on memory-constrained machines.

Frontend:

```powershell
cd frontend
npm test
npm run format:check
npm run lint
npm run typecheck
npm run build
npm audit --registry=https://registry.npmjs.org
```

When you touch UI interaction, also verify the affected flow by hand, including the usual empty states, error states and narrow-viewport layouts. Changes to user-visible behavior, dependencies, configuration or database compatibility must also update `README.md`, the related `docs/` pages and `CHANGELOG.md`.

When you change anything under `docs/**`, `README*.md`, `CONTRIBUTING*.md`, `SECURITY*.md`, `AGENTS.md`, `CLAUDE.md` or `.github/`, run the documentation sweep again:

```powershell
python scripts/check_docs_pii.py
```

It blocks keys, private-key blocks, tokens, phone numbers, email addresses and home-directory paths accidentally copied into documentation; placeholders (`example.com`, `138-0000-0000` and similar) and lines carrying a `pii-ok` comment are let through. When writing docs, see the [verification playbook](docs/verification-playbook.md) (how to write an acceptance check that can actually fail) and the [collaboration SOP](docs/ai-collaboration-sop.md) (structure of task briefs and delivery reports).

## Demo data and screenshots

Screenshots in `README.md` and `docs/` must come from a **really running** app, and the data in them must be **entirely fictional**. One entry point generates the data and self-checks the API; the other is the screenshot procedure described below.

```powershell
backend\.venv\Scripts\python.exe scripts\seed_demo_data.py --check
```

`--check` generates the fictional demo data and runs the 58 read-only endpoints as a self-check; the run writes to `runtime/demo/demo.db`.

Demo persons, companies and schools all carry the fictional "示例" ("sample") prefix; phone numbers are fixed to `0000` and email addresses use the reserved `example.com` domain. `backend/tests/test_seed_demo_data.py` guards this rule, so run it after changing demo data. The screenshot procedure (start the backend with an isolated `DATABASE_URL`, point the frontend at it, then compress to 1440px wide) is documented in "README (project home) and screenshots" in [AGENTS.md](AGENTS.md).

**Do not** put your own real details, real resume or real job links into demo data, and do not screenshot `backend/data/resume_forge.db` directly — that publishes personal information onto the public repository home page.

## Security-sensitive changes

The following paths carry the safety boundaries of web-form filling, the boundaries of outbound requests and the semantics of data backup. A wrong change there can mean the user's resume is submitted to the wrong place, filled in wrongly, or leaked — not an ordinary feature regression. PRs touching these paths **must get one manual security review** on top of the automated checks:

- `backend/app/services/webform/**` (web-form filling engine)
- `backend/app/services/apply/**` (application pipeline and collection)
- `backend/app/services/update_sources.py` (external update sources)
- `backend/app/middleware/**` (inbound request boundaries)
- `backend/app/services/data_backup/**` (backup and restore)

Review checklist (walk it against the boundary map in `deliverables/webform-safety-boundaries-2026-10-06.md`):

- The guard semantics of web-form filling are not relaxed: consent/declaration fields are not auto-filled, passwords/verification codes/bank cards are blocked, fields are filled but never clicked, over-long values are skipped, existing page values are never overwritten, and high-risk ambiguities are left alone — these are one-way boundaries that are never relaxed ("rather miss a field than fill it wrong"), and changing any of them requires a prominently flagged rationale in the PR.
- All new external input (page controls, job descriptions, pasted user content, response fields) is treated as untrusted: validate, cap the length, encode safely, and keep it out of `eval`/templates/concatenated SQL.
- Logs, exception messages and diagnostics exports gain no new sensitive fields (cookies, raw prompts, complete personal profiles).
- Backup/restore paths introduce no new deletion semantics or path concatenation.
- The set of inbound sources the middleware lets through does not grow (Host/Origin/CORS allowlists).

For boundary questions you cannot answer yourself, start with the channel in [SECURITY.md](SECURITY.md) instead of describing exploitable details in a public issue.

## Platform-specific changes

When you change anything under `scripts/macos/**` or `start.command`, run `bash scripts/tests/test-macos-launcher.sh`. The launcher and release-package layer is additionally verified by the CI jobs `macos-launcher-guards`, `macos-runtimes`, `macos-end-to-end` and `windows-end-to-end`; the maintainers have no Mac, so those jobs are the only real-machine verification available. **A live port is not the same as a usable page** — probe the actual page, not just the listening socket.

## Licensing of contributions

ResumeForge is released under the [Apache License 2.0](LICENSE). By submitting a pull request you agree that your contribution is licensed under the same terms, without any additional terms or conditions. No CLA and no copyright assignment is required.

## Pull requests

- One topic per PR: explain the reason, the blast radius and the verification results.
- Flag breaking changes, data migrations, security-boundary changes and new outbound network requests prominently.
- Provide before/after screenshots for UI changes.
- New features and bug fixes need automated tests proportional to the risk.
- Keep the lockfile consistent with the dependency list, but never commit a local virtual environment or `node_modules`.

Do not open a public issue for security problems; report them the way [SECURITY.md](SECURITY.md) describes.

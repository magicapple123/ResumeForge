"""Read-only API self-check (opt-in, runs after a successful seed).

Kept from the original script's ``--check`` but strictly separated from
inspection: this module is only invoked on a freshly seeded database, hits
the app's read-only endpoints through ``TestClient``, and writes nothing.
The database to check is selected through the ``DATABASE_URL`` environment
variable, which :func:`stress_seed.schema.prepare_environment` already
pinned to the fresh run directory.
"""

from __future__ import annotations

CHECKS: list[str] = [
    "/api/health",
    "/api/profile",
    "/api/profile/photos",
    "/api/jobs?page=1&page_size=10",
    "/api/jobs/1",
    "/api/candidate-jobs",
    "/api/candidate-jobs/1",
    "/api/resumes?page=1&page_size=10",
    "/api/resumes/1",
    "/api/resumes/templates",
    "/api/resume-templates",
    "/api/claims",
    "/api/claims/1",
    "/api/materials",
    "/api/materials/1",
    "/api/knowledge?page_size=10",
    "/api/knowledge/categories",
    "/api/tracker",
    "/api/tracker/export?format=csv",
    "/api/reminders",
    "/api/referrals",
    "/api/referrals/stats",
    "/api/interview",
    "/api/interview-experiences",
    "/api/interview/question-banks",
    "/api/interview/reviews",
    "/api/drill",
    "/api/assistant/conversations?limit=100",
    "/api/assistant/conversations/1",
    "/api/assistant/skills",
    "/api/apply/queue",
    "/api/apply/records?page=1&page_size=10",
    "/api/apply/records/grouped?page=1&page_size=10",
    "/api/apply/tasks",
    "/api/apply/tasks/current",
    "/api/apply/config",
    "/api/share-packages",
    "/api/trash",
    "/api/settings/llm",
    "/api/settings/llm/records",
    "/api/stats",
    "/api/stats/storage",
    "/api/analytics/dashboard?trend_months=6",
    "/api/search?q=%E8%99%9A%E6%9E%84",
    "/api/user-files?page=1&page_size=10",
    "/api/webform/fields",
    "/api/webform/extra-profile",
    "/api/webform/records",
    "/api/webform/url-history",
]


def run_api_checks() -> int:
    """Hit every read-only endpoint; return the number of failures."""
    from app.main import app  # noqa: PLC0415
    from fastapi.testclient import TestClient  # noqa: PLC0415

    client = TestClient(app, raise_server_exceptions=False)
    failures: list[str] = []
    for path in CHECKS:
        response = client.get(path)
        if response.status_code >= 400:
            failures.append(f"{response.status_code} {path} :: {response.text[:200]}")
    if failures:
        print("API self-check FAILED:")
        for item in failures:
            print("  " + item.replace("\n", " "))
        return len(failures)
    print(f"API self-check passed: all {len(CHECKS)} read-only endpoints responded OK.")
    return 0

from app.services.diagnostics import diagnostic_snapshot, record_event


def test_diagnostics_redact_profile_like_values():
    record_event(
        "test.event",
        control_count=4,
        email="person@example.com",
        value="private value",
        title="网申页面",
    )

    event = diagnostic_snapshot(limit=1)["events"][-1]

    assert event["event"] == "test.event"
    assert event["details"]["control_count"] == 4
    assert event["details"]["email"] == "<redacted>"
    assert event["details"]["value"] == "<redacted>"
    assert event["details"]["title"] == "网申页面"

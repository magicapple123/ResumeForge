# SPDX-License-Identifier: Apache-2.0
"""UI locale preferences use the existing dataset-scoped settings table."""

import json
from unittest.mock import Mock

import pytest
from app.models.setting import AppSetting
from app.services.ui_locale import UI_LOCALE_KEY, save_ui_locale
from sqlalchemy import select
from sqlalchemy.exc import OperationalError


def test_unconfigured_locale_is_null_and_does_not_create_a_default(client, db_session):
    response = client.get("/api/settings/locale")

    assert response.status_code == 200
    assert response.json() == {"locale": None}
    assert db_session.get(AppSetting, UI_LOCALE_KEY) is None


@pytest.mark.parametrize("locale", ["zh-CN", "en-US"])
def test_locale_roundtrips_without_replacing_other_preferences(client, db_session, locale):
    db_session.add(AppSetting(key="unrelated_preference", value='{"enabled":true}'))
    db_session.commit()

    other = "zh-CN" if locale == "en-US" else "en-US"
    for selected in (locale, other, locale, locale):
        response = client.put("/api/settings/locale", json={"locale": selected})
        assert response.status_code == 200
        assert response.json() == {"locale": selected}
        assert client.get("/api/settings/locale").json() == {"locale": selected}

    db_session.expire_all()
    assert json.loads(db_session.get(AppSetting, UI_LOCALE_KEY).value) == {"locale": locale}
    assert db_session.get(AppSetting, "unrelated_preference").value == '{"enabled":true}'
    assert (
        len(db_session.scalars(select(AppSetting).where(AppSetting.key == UI_LOCALE_KEY)).all())
        == 1
    )


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"locale": None},
        {"locale": ""},
        {"locale": "en-us"},
        {"locale": "fr-FR"},
        {"locale": 1},
        {"locale": True},
        {"locale": "en-US", "extra": "not allowed"},
    ],
)
def test_invalid_locale_does_not_write_a_preference(client, db_session, payload):
    response = client.put("/api/settings/locale", json=payload)

    assert response.status_code == 422
    assert db_session.get(AppSetting, UI_LOCALE_KEY) is None


@pytest.mark.parametrize(
    "raw",
    [
        "not-json",
        "null",
        "true",
        "[]",
        '"en-US"',
        '{"locale":null}',
        '{"locale":"unknown"}',
        '{"locale":"en-US","private":"must-not-log"}',
    ],
)
def test_corrupt_locale_is_null_without_rewriting_or_logging_its_contents(
    client, db_session, caplog, raw
):
    db_session.add(AppSetting(key=UI_LOCALE_KEY, value=raw))
    db_session.commit()

    response = client.get("/api/settings/locale")

    assert response.status_code == 200
    assert response.json() == {"locale": None}
    db_session.expire_all()
    assert db_session.get(AppSetting, UI_LOCALE_KEY).value == raw
    assert "must-not-log" not in caplog.text


def test_same_locale_still_reaches_the_persistence_commit(db_session, monkeypatch):
    save_ui_locale(db_session, "en-US")
    commit = Mock(wraps=db_session.commit)
    monkeypatch.setattr(db_session, "commit", commit)

    assert save_ui_locale(db_session, "en-US") == "en-US"

    commit.assert_called_once_with()
    assert json.loads(db_session.get(AppSetting, UI_LOCALE_KEY).value) == {"locale": "en-US"}


def test_failed_save_rolls_back_the_transaction(db_session, monkeypatch):
    save_ui_locale(db_session, "zh-CN")

    def failed_commit():
        raise OperationalError("fixture commit", {}, RuntimeError("fixture failure"))

    monkeypatch.setattr(db_session, "commit", failed_commit)

    with pytest.raises(OperationalError):
        save_ui_locale(db_session, "en-US")

    assert db_session.is_active
    assert json.loads(db_session.get(AppSetting, UI_LOCALE_KEY).value) == {"locale": "zh-CN"}


def test_browser_locale_write_requires_and_honors_dataset_scope(client, db_session):
    browser = {"X-ResumeForge-Client": "browser"}
    refused = client.put("/api/settings/locale", json={"locale": "en-US"}, headers=browser)
    assert refused.status_code == 409
    assert db_session.get(AppSetting, UI_LOCALE_KEY) is None

    scope = client.get("/api/dataset-scope", headers=browser).json()["scope"]
    accepted = client.put(
        "/api/settings/locale",
        json={"locale": "en-US"},
        headers={**browser, "X-Dataset-Scope": scope},
    )
    assert accepted.status_code == 200

    stale = client.put(
        "/api/settings/locale",
        json={"locale": "zh-CN"},
        headers={**browser, "X-Dataset-Scope": "stale"},
    )
    assert stale.status_code == 409
    assert client.get("/api/settings/locale").json() == {"locale": "en-US"}

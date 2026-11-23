# SPDX-License-Identifier: Apache-2.0
"""B2 profile 身份（T1）：目录按浏览器身份分 + 旧共享目录一次性归属。

为什么这几条是硬要求：两个专用浏览器此前**共用**一个 profile，Edge 把 profile 升到 158
之后 Chrome 157 会拒绝打开（甚至重建空 profile），用户升级后登录态反而全丢。所以
"chrome / edge / custom 各自独立"和"auto 解析后复用同一目录"必须逐条钉死。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app.config import DATA_DIR
from app.services.browser.browser_manager import default_profile_dir
from app.services.browser.profile_identity import (
    ADOPT_ALREADY,
    ADOPT_FAILED,
    ADOPT_MOVED,
    ADOPT_NOTHING,
    ADOPT_TARGET_EXISTS,
    ProfileIdentityError,
    adopt_legacy_profile,
    browser_id_for_choice,
    browser_id_from_executable,
    custom_browser_id,
    prepare_profile_dir,
    profile_dir_for,
    profile_dir_or_root,
    resolve_profile_dir,
)

ROOT = Path("/data/browser-profile")


# ===== 身份解析 =====


def test_chrome_and_edge_get_distinct_directories():
    chrome = resolve_profile_dir(ROOT, choice="chrome")
    edge = resolve_profile_dir(ROOT, choice="edge")

    assert chrome == ROOT / "chrome"
    assert edge == ROOT / "edge"
    assert chrome != edge


def test_custom_identity_is_a_path_hash(tmp_path):
    exe = tmp_path / "MyChromium" / "browser.exe"
    browser_id = custom_browser_id(exe)

    assert browser_id.startswith("custom-")
    assert len(browser_id) == len("custom-") + 8
    assert resolve_profile_dir(ROOT, choice="custom", browser_path=exe) == ROOT / browser_id


def test_custom_path_change_produces_a_new_identity(tmp_path):
    first = resolve_profile_dir(ROOT, choice="custom", browser_path=tmp_path / "a" / "b.exe")
    second = resolve_profile_dir(ROOT, choice="custom", browser_path=tmp_path / "b" / "b.exe")

    assert first != second


def test_custom_path_spelling_does_not_produce_a_new_identity(tmp_path):
    """同一个文件的两种写法必须是同一身份，否则用户改个写法就被当成"换了浏览器"。"""
    one = custom_browser_id(tmp_path / "a" / "b.exe")
    two = custom_browser_id(str(tmp_path / "a" / "b.exe").replace("\\", "/"))

    assert one == two


def test_auto_must_be_resolved_before_it_has_a_directory():
    with pytest.raises(ProfileIdentityError):
        resolve_profile_dir(ROOT, choice="auto")


def test_auto_reuses_the_same_directory_after_resolution():
    chrome_exe = Path("/opt/google/chrome/chrome.exe")

    first = resolve_profile_dir(ROOT, choice="auto", resolved_path=chrome_exe)
    second = resolve_profile_dir(ROOT, choice="auto", resolved_path=chrome_exe)

    assert first == second == ROOT / "chrome"


def test_auto_resolves_edge_from_the_executable_name():
    assert browser_id_from_executable(Path("/x/msedge.exe")) == "edge"
    assert browser_id_from_executable(Path("/x/") / "chrome") == "chrome"


def test_unknown_engine_falls_back_to_a_path_hash():
    """既不是 chrome 也不是 edge（Chromium 分支）：宁可独立目录，也不共用。"""
    identity = browser_id_from_executable(Path("/x/brave.exe"))

    assert identity.startswith("custom-")


def test_explicit_browser_path_wins_over_the_choice():
    """与 ``_locate_browser`` 的优先级一致：给了路径就只用那个路径。"""
    assert browser_id_for_choice("chrome", "/x/custom.exe").startswith("custom-")


def test_profile_dir_or_root_never_raises_for_unresolved_auto():
    assert profile_dir_or_root(ROOT, choice="auto") == ROOT


def test_default_profile_dir_keeps_the_legacy_no_arg_form():
    assert default_profile_dir() == DATA_DIR / "browser-profile"
    assert default_profile_dir("chrome") == DATA_DIR / "browser-profile" / "chrome"


def test_prepare_profile_dir_honours_an_explicit_dir(tmp_path):
    """显式指定的目录（离线测试 / 特殊调试）不再按身份分。"""
    explicit = tmp_path / "pinned"

    prepared = prepare_profile_dir(tmp_path / "root", explicit=explicit, choice="chrome")

    assert prepared.path == explicit
    assert prepared.adoption is None
    assert explicit.is_dir()


# ===== 旧共享 profile 的归属 =====


def _legacy_profile(root: Path) -> Path:
    """造一个"B2 之前"的共享 profile：根目录下直接放 profile 内容。"""
    (root / "Default" / "Network").mkdir(parents=True)
    (root / "Default" / "Network" / "Cookies").write_text("cookie-db")
    (root / "Local State").write_text("{}")
    return root


def test_legacy_profile_is_moved_into_the_identity_subdir(tmp_path):
    root = _legacy_profile(tmp_path / "browser-profile")
    target = root / "chrome"

    adoption = adopt_legacy_profile(root, target)

    assert adoption.outcome == ADOPT_MOVED
    assert adoption.moved_entries == 2
    assert adoption.changed_anything is True
    assert (target / "Default" / "Network" / "Cookies").read_text() == "cookie-db"
    assert (target / "Local State").is_file()


def test_existing_target_stops_adoption_and_keeps_the_old_directory(tmp_path):
    root = _legacy_profile(tmp_path / "browser-profile")
    target = root / "edge"
    (target / "Default").mkdir(parents=True)
    (target / "Default" / "Preferences").write_text("new-profile")

    adoption = adopt_legacy_profile(root, target)

    # 绝不合并两份 profile：合并会让 Cookie / Preferences / Local State 互相覆盖。
    assert adoption.outcome == ADOPT_TARGET_EXISTS
    assert (root / "Default" / "Network" / "Cookies").is_file()
    assert (target / "Default" / "Preferences").read_text() == "new-profile"
    assert not (target / "Default" / "Network").exists()


def test_second_adoption_is_reported_as_already_done(tmp_path):
    root = _legacy_profile(tmp_path / "browser-profile")
    target = root / "chrome"
    adopt_legacy_profile(root, target)

    second = adopt_legacy_profile(root, target)

    assert second.outcome == ADOPT_ALREADY
    assert second.changed_anything is False


def test_switching_browser_never_swallows_the_other_identity_directory(tmp_path):
    """归属过一次之后根目录下是 ``chrome/``；再启动 Edge **不能**把 chrome 拖进 edge。

    这条是真实会毁数据的路径：没有"只搬 profile 内容、不搬身份子目录"这条判断时，
    换浏览器会把 ``browser-profile/chrome`` 整个搬进 ``browser-profile/edge/chrome``，
    Chrome 的登录态当场失踪。
    """
    root = _legacy_profile(tmp_path / "browser-profile")
    adopt_legacy_profile(root, root / "chrome")

    outcome = adopt_legacy_profile(root, root / "edge")

    assert outcome.outcome == ADOPT_ALREADY
    assert (root / "chrome" / "Local State").is_file()
    assert not (root / "edge").exists()


def test_missing_legacy_directory_is_a_no_op(tmp_path):
    adoption = adopt_legacy_profile(tmp_path / "nope", tmp_path / "nope" / "chrome")

    assert adoption.outcome == ADOPT_NOTHING


def test_empty_legacy_shell_directory_is_removed(tmp_path):
    root = tmp_path / "browser-profile"
    root.mkdir()

    adoption = adopt_legacy_profile(root, root / "chrome")

    assert adoption.outcome == ADOPT_NOTHING
    assert not root.exists()


def test_target_outside_the_legacy_directory_is_refused(tmp_path):
    """结构安全阀：只有 ``<root>/<browser-id>`` 这种目标算"归属"。"""
    root = _legacy_profile(tmp_path / "browser-profile")

    adoption = adopt_legacy_profile(root, tmp_path / "elsewhere")

    assert adoption.outcome == ADOPT_FAILED
    assert (root / "Local State").is_file()


# ===== 身份矩阵（证据文件 profile-identity-matrix.txt 用的就是这份取值）=====


def test_identity_matrix(tmp_path):
    custom_exe = tmp_path / "edge-canary" / "chrome.exe"
    matrix = {
        "chrome": resolve_profile_dir(ROOT, choice="chrome"),
        "edge": resolve_profile_dir(ROOT, choice="edge"),
        "custom": resolve_profile_dir(ROOT, choice="custom", browser_path=custom_exe),
        "auto->chrome": resolve_profile_dir(
            ROOT, choice="auto", resolved_path=Path("/x/chrome.exe")
        ),
    }

    # chrome / edge / custom 三种身份各自独立；auto 解析成 Chrome 后**复用** chrome 的目录。
    assert len({str(path) for path in matrix.values()}) == 3
    assert matrix["chrome"] == matrix["auto->chrome"]
    assert all(Path(value).parent == ROOT for value in matrix.values())
    assert profile_dir_for(ROOT, "edge") == ROOT / "edge"

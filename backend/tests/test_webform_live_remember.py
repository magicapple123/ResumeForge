"""「记住这条」：把面板上的值记进网申资料（Python 侧，从 test_webform_live.py 拆出）。

FakeLiveClient/raw_control 留在 test_webform_live.py；AI_DATA/UNKNOWN_LABEL 定义在
test_webform_live_ai.py（「记住这条」的判定与 AI 兜底共用"认不出"这一前提）。
"""
from app.services.webform.live import LiveSession
from app.services.webform.service import suggest_for

from test_webform_live import FakeLiveClient, raw_control
from test_webform_live_ai import AI_DATA, UNKNOWN_LABEL


def _remember_session(client, data=None, **kwargs) -> tuple[LiveSession, list[dict]]:
    """起一个带落库回调的会话，回调把每次写入记进列表并回报成功。"""
    saved: list[dict] = []

    def store(entry: dict[str, str]) -> bool:
        saved.append(entry)
        return True

    session = LiveSession(client, data if data is not None else AI_DATA, store=store, **kwargs)
    return session, saved


def test_remembering_a_recognized_field_uses_its_catalog_key():
    """**认得出的字段按目录 key 记**——这是它下次还能自动填的前提。

    走 ``CUSTOM_`` 的话下次只有标签一个信号，匹配不上；只有落在目录 key 上，背后那
    五到十个同义词才用得上。
    """
    client = FakeLiveClient()
    session, saved = _remember_session(client)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "178")
        session._tick()

        assert saved == [{"key": "height", "label": "身高(cm)", "value": "178"}]
        assert "已记住" in client.panels[-1]["note"]
    finally:
        session.stop()


def test_remembering_an_unrecognized_field_uses_a_custom_key():
    """**认不出的**用控件自己的话规范成 ``CUSTOM_*``：存得下、看得见、能手填。"""
    client = FakeLiveClient()
    session, saved = _remember_session(client)
    session.start()
    try:
        control = raw_control(label=UNKNOWN_LABEL)
        client.focus_on(control)
        client.remember_on(control, "同意")
        session._tick()

        assert len(saved) == 1
        assert saved[0]["key"].startswith("CUSTOM_")
        assert UNKNOWN_LABEL in saved[0]["key"]
        assert saved[0]["label"] == UNKNOWN_LABEL
        assert saved[0]["value"] == "同意"
    finally:
        session.stop()


def test_remembering_a_recognized_field_with_no_data_still_works():
    """**这是用户明确要的那一档**：认得出、但资料里没值（``missing_data``）也要能记。

    那个框在面板上说的是"去我的资料补一下"，用户就地按「记住这条」把它补进网申资料——
    比跳去另一屏录一遍顺手得多。
    """
    # AI_DATA 里有 advisor，这里换一个目录里有、但这份资料里没有的字段。
    client = FakeLiveClient()
    session, saved = _remember_session(client, data={"name": "张三"})
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        # 先确认它确实是"认得出但没值"
        suggest = suggest_for(
            LiveSession._build_control(control), {"name": "张三"}, engine=session._engine
        )
        assert suggest.status == "unmatched", "前提不成立：这个字段有值"

        client.remember_on(control, "178")
        session._tick()

        assert saved == [{"key": "height", "label": "身高(cm)", "value": "178"}]
    finally:
        session.stop()


def test_remembering_clears_the_intent_so_it_is_not_stored_twice():
    """记完要清掉标记，否则下一轮会把同一条**重复记一遍**。"""
    client = FakeLiveClient()
    session, saved = _remember_session(client)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "178")
        session._tick()
        assert client.remember is None, "回执没有清掉标记"
        assert len(saved) == 1

        session._tick()  # 下一轮：标记已经清了，不该再记一次

        assert len(saved) == 1
    finally:
        session.stop()


def test_remembering_an_empty_value_is_ignored():
    """空值没什么可记的——库里"没有这一项"与"这一项是空的"是同一件事。"""
    client = FakeLiveClient()
    session, saved = _remember_session(client)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "   ")
        session._tick()

        assert saved == []
    finally:
        session.stop()


def test_remembering_without_a_store_says_so_instead_of_pretending():
    """没接上落库回调时**如实说记不了**，不静默假成功。

    假装成功比不显示更糟：用户以为记下了，下次填表却什么都没有，而且无从知道为什么。
    """
    client = FakeLiveClient()
    session = LiveSession(client, AI_DATA)  # 没有 store
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "178")
        session._tick()

        assert "记不了" in client.panels[-1]["note"]
    finally:
        session.stop()


def test_a_store_failure_does_not_kill_the_poll_loop():
    """落库抛异常不能弄死轮询线程——那会让整个模式停止响应，而用户只按了个「记住」。"""
    client = FakeLiveClient()

    def broken_store(entry: dict[str, str]) -> bool:
        raise RuntimeError("库锁住了")

    session = LiveSession(client, AI_DATA, store=broken_store)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "178")
        session._tick()

        assert "没能记住" in client.panels[-1]["note"]
        # 轮询还活着：再走一轮不会抛。
        session._tick()
    finally:
        session.stop()


def test_remembering_keeps_the_suggestion_on_the_panel():
    """回执只改 ``note``，**不动 ``status``/``value``**。

    否则用户按一下「记住」，面板上那条建议就没了——他本来可能接着要按「填入」。
    """
    client = FakeLiveClient()
    session, _ = _remember_session(client)
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        assert session.state["status"] == "matched"

        control = raw_control(label="姓名")
        client.remember_on(control, "张三")
        session._tick()

        assert session.state["status"] == "matched", "记住之后建议被清掉了"
        assert session.state["value"] == "张三"
    finally:
        session.stop()


def test_api_sessions_pause_for_an_explicit_memory_target_choice():
    """新的 API 会话不能默认覆盖资料，必须先把 pending 交给用户选择。"""
    client = FakeLiveClient()
    session, saved = _remember_session(client, require_memory_choice=True)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        session._tick()
        client.remember_on(control, "178")
        session._tick()

        assert saved == []
        assert session.state["remember_pending"] == {
            "field_key": "height",
            "field_label": "身高(cm)",
            "value": "178",
            "control_label": "身高(cm)",
            "source": "rule",
        }

        assert (
            session.remember_choice(
                target_id="extra:height",
                value="178",
                label="身高(cm)",
                reuse="general",
            )
            is True
        )
        assert saved == [
            {
                "target_id": "extra:height",
                "key": "height",
                "value": "178",
                "label": "身高(cm)",
                "reuse": "general",
            }
        ]
        assert session.state["remember_pending"] is None
    finally:
        session.stop()


def test_live_session_refreshes_profile_data_before_the_next_focus():
    """另一个界面补资料后，下一次点框不能继续使用启动时的旧快照。"""
    client = FakeLiveClient()
    current = {"name": "张三"}

    def load_data():
        return dict(current), [{"group": "身份信息", "label": "姓名", "value": current["name"]}]

    session = LiveSession(client, current, data_loader=load_data)
    session.start()
    try:
        first = raw_control(label="姓名")
        client.focus_on(first)
        session._tick()
        assert client.panels[-1]["value"] == "张三"

        current["name"] = "李四"
        client.focus_on(raw_control(label="姓名"))
        session._tick()

        assert client.panels[-1]["value"] == "李四"
    finally:
        session.stop()

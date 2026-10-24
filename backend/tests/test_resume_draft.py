# SPDX-License-Identifier: Apache-2.0
"""0051：制作台草稿（``resume_record.draft``）的可见性边界。

一条规则要钉住两半：

1. **没保存就看不见**——列表、``/ids``、搜索、统计都不该出现它。用户只是点进制作台
   看了一眼，简历中心里不该凭空多出一份空白简历。
2. **保存了就看得见**——内容 ``PUT`` 或版式 ``PATCH`` 任一成功即转正。少这一半，
   用户辛苦排好的简历会永久留在草稿里，比"多出一份"更糟。
"""

from app.models.resume import ResumeRecord


def _create_manual(client, *, title: str, draft: bool) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": title, "content": {"name": "张三"}, "job_id": None, "draft": draft},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_draft_is_invisible_everywhere_until_it_is_saved(client, db_session):
    saved_id = _create_manual(client, title="已保存的简历", draft=False)
    draft_id = _create_manual(client, title="制作台里的草稿", draft=True)

    listed = client.get("/api/resumes").json()
    assert [item["id"] for item in listed["items"]] == [saved_id]
    assert listed["total"] == 1

    # 「全选全部简历」用的 id 清单同样不能带上它，否则批量删除会把一份没保存的草稿算进去。
    assert client.get("/api/resumes/ids").json() == [saved_id]

    # 全局搜索、统计计数（首页/看板读的就是这两个）都不能看见草稿。
    assert client.get("/api/search", params={"q": "草稿"}).json()["resumes"] == []
    stats = client.get("/api/stats").json()
    assert stats["resume_count"] == 1
    assert all(item["id"] != draft_id for item in stats["latest_resumes"])

    # 但制作台自己要读得到它：按 id 取详情不受草稿影响（它要渲染 HTML、要能 PATCH）。
    # 而且详情必须**如实说这是草稿**——制作台的「保存」按钮靠这个标志常驻，否则一份
    # 刚建出来、内容与版式都没动过的草稿根本没有保存入口。
    detail = client.get(f"/api/resumes/{draft_id}")
    assert detail.status_code == 200
    assert detail.json()["id"] == draft_id
    assert detail.json()["draft"] is True


def test_detail_reports_draft_false_for_a_normal_resume(client, db_session):
    saved_id = _create_manual(client, title="已保存的简历", draft=False)

    assert client.get(f"/api/resumes/{saved_id}").json()["draft"] is False


def test_saving_the_content_promotes_the_draft(client, db_session):
    draft_id = _create_manual(client, title="制作台里的草稿", draft=True)

    response = client.put(
        f"/api/resumes/{draft_id}",
        json={"name": "张三", "summary": "改过一句措辞"},
    )
    assert response.status_code == 200, response.text

    db_session.expire_all()
    assert db_session.get(ResumeRecord, draft_id).draft is False
    # 转正与 revision+1 在同一条 UPDATE 里（W02）：用户点过保存就该是新的一版，
    # 不能出现"草稿转正了、版本号还停在 0"这种半状态。
    assert db_session.get(ResumeRecord, draft_id).revision == 1
    assert [item["id"] for item in client.get("/api/resumes").json()["items"]] == [draft_id]
    # 响应体也要立刻改口：前端靠它把「保存到简历中心」换回普通的「保存修改」。
    assert response.json()["draft"] is False


def test_saving_the_layout_promotes_the_draft(client, db_session):
    """只调了排版也算"保存过"：用户可能一个字没改，只把版面排好就关掉。"""
    draft_id = _create_manual(client, title="制作台里的草稿", draft=True)

    response = client.patch(
        f"/api/resumes/{draft_id}/layout",
        json={"template": "classic", "page_limit": 2, "font_scale": "small"},
    )
    assert response.status_code == 200, response.text

    db_session.expire_all()
    assert db_session.get(ResumeRecord, draft_id).draft is False
    assert [item["id"] for item in client.get("/api/resumes").json()["items"]] == [draft_id]


def test_marking_saved_twice_is_harmless(client, db_session):
    """重复保存是常态（先存版式再存内容）：第二次不能再改任何东西，也不能报错。"""
    draft_id = _create_manual(client, title="制作台里的草稿", draft=True)

    assert client.put(f"/api/resumes/{draft_id}", json={"name": "张三"}).status_code == 200
    assert (
        client.patch(
            f"/api/resumes/{draft_id}/layout",
            json={"template": "classic", "page_limit": 1, "font_scale": "standard"},
        ).status_code
        == 200
    )

    db_session.expire_all()
    assert db_session.get(ResumeRecord, draft_id).draft is False

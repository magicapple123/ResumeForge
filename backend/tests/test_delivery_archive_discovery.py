"""Historical evidence must remain discoverable without knowing a deleted resume ID."""

from app.models.resume import ResumeRecord
from app.services.resume.resume_delivery import freeze_delivery


def _delivery(db):
    resume = ResumeRecord(
        title="synthetic retained evidence",
        content={"name": "Synthetic"},
        template="classic",
        page_limit=1,
        font_scale="standard",
    )
    db.add(resume)
    db.commit()
    delivery = freeze_delivery(
        db,
        record=resume,
        source="track",
        company="synthetic company",
        render_context={"template": "classic", "page_limit": 1},
    )
    db.commit()
    return resume.id, delivery.id


def test_archive_list_survives_source_soft_delete_and_purge(client, db_session):
    resume_id, delivery_id = _delivery(db_session)
    assert client.delete(f"/api/resumes/{resume_id}").status_code == 204
    assert client.delete(f"/api/trash/resume/{resume_id}").status_code == 204
    response = client.get("/api/resumes/deliveries?page=1&page_size=10")
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == delivery_id
    assert "content" not in response.json()["items"][0]
    assert client.get(f"/api/resumes/deliveries/{delivery_id}/download").status_code == 200


def test_archive_keyword_and_source_filters_are_literal_and_bounded(client, db_session):
    _delivery(db_session)
    assert client.get("/api/resumes/deliveries?keyword=synthetic&source=track").json()["total"] == 1
    assert client.get("/api/resumes/deliveries?keyword=%25").json()["total"] == 0
    assert client.get("/api/resumes/deliveries?source=unknown").status_code == 422
    assert client.get("/api/resumes/deliveries?page_size=10000").status_code == 422

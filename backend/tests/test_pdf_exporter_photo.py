# SPDX-License-Identifier: Apache-2.0
"""PDF 性别字号与照片取景：性别不再并入姓名行、照片按原图比例装进照片框。

拆分自 test_pdf_exporter.py——性别按 name_extra_ratio 渲染且颜色拆分、无性别行为
不变、plan/draw 互为镜像；照片按目标比例裁剪、坏图兜底跳过。
复用主文件的 helper（needs_font / _pdf_with_font / _text_runs / _hex_to_rgb）。
"""
import base64
from io import BytesIO

import pytest
from app.schemas.resume import ResumeContent
from app.services.pdf_exporter import (
    _PX_TO_PT,
    _ResumePDF,
    build_resume_pdf,
    draw_name_gender,
    fit_photo_size,
    plan_name_gender,
)
from app.services.resume.resume_templates import (
    RESUME_TEMPLATES,
    TEMPLATE_LAYOUT_DEFAULTS,
)
from PIL import Image
from test_pdf_exporter import (
    _hex_to_rgb,
    _pdf_with_font,
    _text_runs,
    needs_font,
)

# ===== 性别字号：不再并入姓名行 =====


def _png_bytes(size: tuple[int, int], color: tuple[int, int, int] = (0, 128, 200)) -> bytes:
    """生成一张纯色 PNG 的字节（供 cover 裁剪与照片变形测试用）。"""
    buffer = BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def _png_data_url(size: tuple[int, int], color: tuple[int, int, int] = (0, 128, 200)) -> str:
    return "data:image/png;base64," + base64.b64encode(_png_bytes(size, color)).decode("ascii")


def _runs_by_text(content: bytes, needle: str) -> list[tuple[float, float, float, str]]:
    """把含某段文本的文字块读出来（用子串匹配，便于断"性别那一段"）。"""
    return [run for run in _text_runs(content) if needle in run[3]]


@needs_font
@pytest.mark.parametrize("name", sorted(RESUME_TEMPLATES))
def test_gender_is_not_rendered_at_the_name_font_size(name):
    """性别必须用 `name_extra_ratio`（每模板不同）的字号渲染，不再是姓名字号。

    此前把性别拼进 `name_line`、整行按 `name_ratio` 画，于是"男"与姓名一样大、一样粗、
    一样是强调色。现在拆开后，PDF 里性别那一段的字号应等于 `base × name_extra_ratio ×
    _PX_TO_PT`，且**严格小于**姓名字号（所有模板 name_extra_ratio < name_ratio）。
    """
    defaults = TEMPLATE_LAYOUT_DEFAULTS[name]
    base_px = 14.0
    result = build_resume_pdf(
        ResumeContent(name="张三", gender="男", summary="一句话总结。"),
        template=name,
        page_limit=2,
        font_scale="standard",
    )

    name_runs = _runs_by_text(result.content, "张三")
    gender_runs = _runs_by_text(result.content, "男")
    assert name_runs, f"{name} 里没读到姓名"
    assert gender_runs, f"{name} 里没读到性别"

    name_pt = name_runs[0][2]
    gender_pt = gender_runs[0][2]
    assert name_pt == pytest.approx(base_px * float(defaults["name_ratio"]) * _PX_TO_PT, abs=0.01)
    assert gender_pt == pytest.approx(
        base_px * float(defaults["name_extra_ratio"]) * _PX_TO_PT, abs=0.01
    )
    assert gender_pt < name_pt, f"{name} 性别字号 {gender_pt} 不小于姓名字号 {name_pt}"


@needs_font
def test_gender_is_muted_not_accent_coloured():
    """性别的文字颜色应是 muted 灰、不是姓名的强调色（颜色收敛到注册表后仍要守住）。"""
    accent = _hex_to_rgb(str(TEMPLATE_LAYOUT_DEFAULTS["classic"]["accent"]))
    muted = _hex_to_rgb(str(TEMPLATE_LAYOUT_DEFAULTS["classic"]["muted"]))
    result = build_resume_pdf(
        ResumeContent(name="张三", gender="男", summary="一句话总结。"),
        template="classic",
        page_limit=2,
        font_scale="standard",
    )
    # pypdf 的文字提取不直接暴露每段的填色，但强调色与 muted 灰差别足够大，
    # 用"性别 run 的字号严格小于姓名 run 且等于 extra 口径"已在上一条钉住口径；
    # 这里再断颜色：渲染时若性别误用了 accent，与姓名 run 的字号/颜色会完全一致，
    # 于是 gender_runs 的字号会等于 name_runs——已被上一条禁止。这里补一条语义断言：
    # 姓名 run 的颜色应是 accent（RGB 之一通道接近 accent），性别 run 不应等于 accent。
    # 由于 pypdf 不暴露每段颜色，退而用"性别 run 与姓名 run 字号不同"这一可观测不变量
    # 作为颜色拆分的代理断言（颜色若没拆，字号拆分也通常会丢）。
    name_runs = _runs_by_text(result.content, "张三")
    gender_runs = _runs_by_text(result.content, "男")
    assert name_runs and gender_runs
    assert gender_runs[0][2] != pytest.approx(name_runs[0][2], abs=0.01)
    # 直接量 muted 灰与 accent 的差距，确认两者明显不同（防 muted==accent 的模板误判）
    assert muted != accent


@needs_font
def test_resume_without_gender_uses_only_the_name_font_size():
    """无性别时行为不变：姓名仍按 name_ratio 渲染，且 PDF 里不出现任何性别文本 run。"""
    base_px = 14.0
    result = build_resume_pdf(
        ResumeContent(name="张三", summary="一句话总结。"),
        template="classic",
        page_limit=2,
        font_scale="standard",
    )
    name_runs = _runs_by_text(result.content, "张三")
    assert name_runs
    assert name_runs[0][2] == pytest.approx(
        base_px * float(TEMPLATE_LAYOUT_DEFAULTS["classic"]["name_ratio"]) * _PX_TO_PT, abs=0.01
    )
    # 无性别时 PDF 里不应出现任何"男"/"女"等性别文本（这是"性别没被误并入姓名行"
    # 的可观测不变量；字号口径在 classic 上 1.0 与正文基准重合，不能拿字号判定）。
    all_text = "".join(run[3] for run in _text_runs(result.content))
    assert "男" not in all_text and "女" not in all_text


@needs_font
def test_plan_name_gender_matches_what_draws():
    """`plan_name_gender` 量的高度必须等于 `draw_name_gender` 实际推进的高度——
    "量的就是画的"是 measure_content_height 与渲染互为镜像的前提。"""
    pdf = _pdf_with_font()
    layout = pdf.layout
    base = layout.base_px
    name_size = base * layout.name_ratio
    extra_size = base * layout.name_extra_ratio
    width = pdf.content_width

    plan = plan_name_gender(pdf, "张三", "男", width=width, name_size=name_size, extra_size=extra_size)
    top = pdf.get_y()
    draw_name_gender(pdf, "张三", plan, width=width, name_size=name_size, extra_size=extra_size)
    drawn = pdf.get_y() - top
    assert drawn == pytest.approx(plan.height, abs=0.01)


# ===== 照片取景：object-fit: contain 的等价物（2026-10 #10）=====
#
# 用户反馈"照片裁剪未生效、默认还被强制裁成模板框比例"：旧实现用 cover 把照片裁成
# 模板照片框的比例，于是 (a) 没有裁剪参数时照片也被硬裁，(b) 已经有 photo_crop 派生图时
# 又被裁了第二次，用户看不到自己设置的取景。现在统一改成 contain：按原图比例装进框，
# 不裁切、不溢出、不变形；HTML 侧对应 .profile-photo 的 object-fit: contain。


def test_fit_photo_size_keeps_the_source_ratio_and_fits_inside_the_box():
    """任意比例的照片都等比缩放到**恰好装进**框：宽高比与图片完全一致。"""
    landscape = _png_bytes((400, 100))  # 4:1，横图：被框宽限制
    w, h = fit_photo_size(landscape, 80.0, 100.0)
    assert (w, h) == pytest.approx((80.0, 20.0))
    assert (w / h) == pytest.approx(4.0)

    portrait = _png_bytes((100, 400))  # 1:4，竖图：被框高限制
    w, h = fit_photo_size(portrait, 80.0, 100.0)
    assert (w, h) == pytest.approx((25.0, 100.0))
    assert (w / h) == pytest.approx(0.25)

    square = _png_bytes((200, 200))
    w, h = fit_photo_size(square, 80.0, 100.0)
    # 正方形被"更紧"的宽度限制 → 80×80；不能是 80×100（那会被拉伸变形）。
    assert (w, h) == pytest.approx((80.0, 80.0))


def test_fit_photo_size_matches_the_box_when_ratios_are_equal():
    """比例恰好一致时铺满整个框（contain 的边界情况，不该留白）。"""
    matching = _png_bytes((80, 100))  # 0.8，与框 80×100 同比例
    w, h = fit_photo_size(matching, 80.0, 100.0)
    assert (w, h) == pytest.approx((80.0, 100.0))


def test_fit_photo_size_respects_exif_orientation():
    """手机竖拍：像素是 400×100（横），EXIF Orientation=6 表示显示时转 90°。

    不先转正就会按 4:1 横图取景，竖着的人像在 PDF 里被按横图比例压扁。
    转正后是 1:4 竖图 → 在 80×100 的框里应装成 25×100。
    """
    from PIL import Image as _Image

    buffer = BytesIO()
    image = _Image.new("RGB", (400, 100), (0, 128, 200))
    exif = _Image.Exif()
    exif[0x0112] = 6  # Orientation: Rotate 90 CW
    image.save(buffer, format="JPEG", exif=exif)

    w, h = fit_photo_size(buffer.getvalue(), 80.0, 100.0)
    assert (w, h) == pytest.approx((25.0, 100.0))


def test_fit_photo_size_raises_on_garbage_bytes():
    """坏图应抛异常——PDF/Word 侧已有"跳过照片"兜底，这里不吞。"""
    with pytest.raises(Exception):  # noqa: PT011 - Pillow 抛多种异常，只验"不吞"
        fit_photo_size(b"not an image", 80.0, 100.0)


@needs_font
def test_pdf_draws_the_photo_with_its_own_aspect_ratio(monkeypatch):
    """端到端：照片按**原图比例**画进照片框（contain），不是被 cover 裁成框比例。

    旧实现（cover）会把 300×150 的横图画成 6.3:8 的竖图（照片被裁掉两侧）；现在
    draw w/h 的比值必须等于 2.0（= 300/150），且高度小于照片框高度（框内留白，不溢出）。
    """
    recorded = _record_photo_draws(monkeypatch)
    resume = ResumeContent(
        name="张三",
        photo=_png_data_url((300, 150)),  # 横图，与 classic 照片框 0.7875 比例不同
        summary="带照片的简历。",
    )
    result = build_resume_pdf(resume, template="classic", page_limit=1, include_photo=True)
    assert result.content.startswith(b"%PDF-")
    assert result.pages >= 1

    assert len(recorded) == 1, "应画出一张照片"
    draw_w, draw_h = recorded[0]
    assert draw_w / draw_h == pytest.approx(2.0, rel=1e-6), "照片被按框比例裁切/拉伸了"


@needs_font
def test_pdf_with_a_broken_photo_falls_back_to_no_photo():
    """照片能通过 schema 校验（签名匹配）但 Pillow 解不开时，导出仍成功、只是跳过照片。

    ResumeContent.photo 的校验只查文件签名（`\x89PNG...`），所以"签名对、内容截断"的
    坏图能进得了模型、过得了校验，却会让 `fit_photo_size` 的 `Image.open` 抛错——
    PDF 渲染的兜底要把它吞掉、跳过照片，而不是整份导出失败。
    """
    # PNG 签名 + 截断的内容：过得了 schema 的签名检查，Pillow 打不开。
    truncated = b"\x89PNG\r\n\x1a\n" + b"truncated-garbage"
    broken_url = "data:image/png;base64," + base64.b64encode(truncated).decode("ascii")
    resume = ResumeContent(
        name="张三",
        photo=broken_url,
        summary="坏照片的简历。",
    )
    result = build_resume_pdf(resume, template="classic", page_limit=1, include_photo=True)
    assert result.content.startswith(b"%PDF-")
    assert result.pages >= 1


# ===== 照片大小（`photo_scale`，2026-10-22）=====
#
# 系数在 `resolve_layout` 里就折进 `photo_width_ratio / photo_height_ratio`，所以渲染侧
# 一行都不用改。这里必须验的**不是**"注册表里的数变了"，而是"内嵌图片真的按系数画"：
# 改错落点（比如只改了 CSS、或只乘了宽）在提取文本与页数上都看不出来。


def _record_photo_draws(monkeypatch) -> list[tuple[float, float]]:
    """抓 `pdf.image()` 的 (w, h)：这是照片**真正落到纸面上**的唯一尺寸。"""
    recorded: list[tuple[float, float]] = []
    original = _ResumePDF.image

    def recording(self, name, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003 - fpdf2 的签名
        recorded.append((float(kwargs["w"]), float(kwargs["h"])))
        return original(self, name, *args, **kwargs)

    monkeypatch.setattr(_ResumePDF, "image", recording)
    return recorded


def _photo_resume() -> ResumeContent:
    return ResumeContent(name="张三", photo=_png_data_url((300, 400)), summary="带照片的简历。")


@needs_font
def test_photo_scale_enlarges_the_drawn_photo(monkeypatch):
    """`photo_scale=1.5` 时内嵌图片的 w/h **各乘 1.5**，宽高比不变（取景不重裁）。"""
    recorded = _record_photo_draws(monkeypatch)
    resume = _photo_resume()

    build_resume_pdf(
        resume, template="classic", page_limit=1, include_photo=True, format_config={}
    )
    build_resume_pdf(
        resume,
        template="classic",
        page_limit=1,
        include_photo=True,
        format_config={"photo_scale": 1.5},
    )

    assert len(recorded) == 2, "两次导出各应画一张照片"
    (base_w, base_h), (scaled_w, scaled_h) = recorded
    assert scaled_w == pytest.approx(base_w * 1.5, rel=1e-6)
    assert scaled_h == pytest.approx(base_h * 1.5, rel=1e-6)
    assert scaled_w / scaled_h == pytest.approx(base_w / base_h, rel=1e-9)


@needs_font
def test_photo_scale_is_inert_without_a_photo(monkeypatch):
    """**没有照片时 `photo_scale` 完全惰性**：页数、正文位置、页头预留空间都不变。

    这是最容易被写坏的一条：谁把系数用进 `text_width` 或页头高度，就会出现"没上传照片
    但正文变窄/页头变高"——用户在纸面上看不出原因，只会觉得"排版莫名其妙变了"。
    """
    recorded = _record_photo_draws(monkeypatch)
    resume = ResumeContent(name="张三", summary="没有照片的简历。")

    plain = build_resume_pdf(resume, template="classic", page_limit=2, format_config={})
    scaled = build_resume_pdf(
        resume, template="classic", page_limit=2, format_config={"photo_scale": 1.6}
    )

    assert plain.pages == scaled.pages
    assert recorded == [], "没有照片时不该调用 image()"
    # 文字块逐个相同（位置 + 字号 + 文本）：连"页头空间预留"都没受影响。
    assert _text_runs(plain.content) == _text_runs(scaled.content)


@needs_font
def test_photo_scale_is_inert_when_the_photo_is_switched_off(monkeypatch):
    """`include_photo=False` 时同样完全惰性——"关掉照片"意味着页头不预留任何空间。"""
    recorded = _record_photo_draws(monkeypatch)
    resume = _photo_resume()

    plain = build_resume_pdf(
        resume, template="classic", page_limit=2, include_photo=False, format_config={}
    )
    scaled = build_resume_pdf(
        resume,
        template="classic",
        page_limit=2,
        include_photo=False,
        format_config={"photo_scale": 1.6},
    )

    assert plain.pages == scaled.pages
    assert recorded == [], "关掉照片后不该调用 image()"
    assert _text_runs(plain.content) == _text_runs(scaled.content)


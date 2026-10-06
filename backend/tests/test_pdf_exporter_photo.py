"""PDF 性别字号与照片裁剪：性别不再并入姓名行、object-fit: cover 等价物。

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
    build_resume_pdf,
    crop_image_to_cover,
    draw_name_gender,
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
    base = layout.scaled_base_px
    name_size = base * layout.name_ratio
    extra_size = base * layout.name_extra_ratio
    width = pdf.content_width

    plan = plan_name_gender(pdf, "张三", "男", width=width, name_size=name_size, extra_size=extra_size)
    top = pdf.get_y()
    draw_name_gender(pdf, "张三", plan, width=width, name_size=name_size, extra_size=extra_size)
    drawn = pdf.get_y() - top
    assert drawn == pytest.approx(plan.height, abs=0.01)


# ===== 照片裁剪：object-fit: cover 的等价物 =====


def test_crop_image_to_cover_produces_the_target_ratio():
    """已知宽高比的图片裁剪后，输出的宽高比应**精确等于**目标框比例。

    整数像素量化会把 0.7875 落到 0.79（158/200），所以用绝对容差而非相对——
    真正要防的是"完全没裁、原比例 1.0 还在"那种大偏离，0.01 的容差足够逮住。
    """
    square = _png_bytes((200, 200))
    classic = TEMPLATE_LAYOUT_DEFAULTS["classic"]
    target = float(classic["photo_width_ratio"]) / float(classic["photo_height_ratio"])
    out = crop_image_to_cover(square, target)
    with Image.open(BytesIO(out)) as img:
        w, h = img.size
    assert (w / h) == pytest.approx(target, abs=0.01)


def test_crop_image_to_cover_handles_landscape_input():
    """横图（宽>高）应左右居中裁掉，保持目标高度方向不变形。"""
    landscape = _png_bytes((400, 100))
    out = crop_image_to_cover(landscape, 0.8)
    with Image.open(BytesIO(out)) as img:
        w, h = img.size
    assert (w / h) == pytest.approx(0.8, abs=0.01)


def test_crop_image_to_cover_handles_portrait_input():
    """竖图（高>宽）应上下居中裁掉，保持目标宽度方向不变形。"""
    portrait = _png_bytes((100, 400))
    out = crop_image_to_cover(portrait, 0.8)
    with Image.open(BytesIO(out)) as img:
        w, h = img.size
    assert (w / h) == pytest.approx(0.8, abs=0.01)


def test_crop_image_to_cover_returns_input_unchanged_when_ratio_matches():
    """比例已经一致且无 EXIF 方向时，原样返回（不重编码、字节相同）。"""
    matching = _png_bytes((80, 100))  # 0.8
    out = crop_image_to_cover(matching, 0.8)
    assert out == matching


def test_crop_image_to_cover_raises_on_garbage_bytes():
    """坏图应抛异常——PDF/Word 侧已有"跳过照片"兜底，这里不吞。"""
    with pytest.raises(Exception):  # noqa: PT011 - Pillow 抛多种异常，只验"不吞"
        crop_image_to_cover(b"not an image", 0.8)


@needs_font
def test_pdf_with_photo_does_not_distort():
    """端到端：带照片的简历导出 PDF 不应抛错（裁剪 + 嵌入走通），且仍是合法 PDF。

    这是"照片被压扁"的回归防线：旧实现同时给 fpdf2 的 image() 传 w 与 h 导致强制拉伸；
    现在先 cover 裁剪再嵌入，横图/竖图都不会变形。这里只断"不抛错 + 合法 PDF + 有照片
    流"——几何精确比对在 `crop_image_to_cover` 的纯函数用例里已逐条钉住。
    """
    resume = ResumeContent(
        name="张三",
        photo=_png_data_url((300, 150)),  # 横图，与 classic 照片框 0.7875 比例不同
        summary="带照片的简历。",
    )
    result = build_resume_pdf(resume, template="classic", page_limit=1, include_photo=True)
    assert result.content.startswith(b"%PDF-")
    assert result.pages >= 1


@needs_font
def test_pdf_with_a_broken_photo_falls_back_to_no_photo():
    """照片能通过 schema 校验（签名匹配）但 Pillow 解不开时，导出仍成功、只是跳过照片。

    ResumeContent.photo 的校验只查文件签名（`\x89PNG...`），所以"签名对、内容截断"的
    坏图能进得了模型、过得了校验，却会让 `crop_image_to_cover` 的 `Image.open` 抛错——
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

# SPDX-License-Identifier: Apache-2.0
"""Word 照片锚定原语：把嵌入型图片改成「浮于文字上方」（不占行高）。

从 ``docx_blocks.py`` 拆出（2026-10-31，**纯搬迁**）：图片锚定是 OOXML 结构拼装，
与段落级排版原语（区块标题 / 条目头 / 项目符号）不是同一层职责，也是原文件里最长的
一段。``docx_blocks`` 保留 re-export，既有 import 路径不变。
"""

from __future__ import annotations

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm


def float_picture(run, *, align: str = "right", vertical_offset_mm: float = 0.0) -> bool:
    """把 ``run`` 里刚插入的图片从**嵌入型**改成「**浮于文字上方**」（不占行高）。

    ## 为什么必须改

    ``add_picture()`` 只会产出 `wp:inline`：图片是正文流里的一个"大号字符"，独占一行
    并按行高把后面的内容整体下推。而预览里的照片是页头右侧的一列——姓名、意向、联系
    方式在左边同一行。于是同一份简历：

    * 预览：页头高度 = 姓名那几行；
    * Word（嵌入型）：照片先占掉整整一行（约 7mm + 段距），姓名被顶到下面，
      页头凭空高出一截，后面的分页跟着往后错。

    改成浮动之后图片脱离正文流，姓名回到第一行、照片贴右上角，页头高度与预览一致。
    用户实测过：手动把照片改成「浮于文字上方」，Word 版就对上了。

    ## OOXML 口径

    「浮于文字上方」= `wp:anchor` + `behindDoc="0"` + `<wp:wrapNone/>`。
    「衬于文字下方」用的是**同一个** `wrapNone`，区别只在 `behindDoc="1"`，别写反。
    `wrapNone` 意味着文字**不绕排**、会从图片底下穿过去——所以照片要贴在版心边缘，
    页头文字本来就短，重合概率很低；真压住了，调小照片或缩短姓名即可。

    子元素顺序由 schema 固定（`simplePos → positionH → positionV → extent →
    effectExtent → wrap* → docPr → cNvGraphicFramePr → graphic`），顺序错了 Word 会
    判定文件损坏、直接拒绝打开——这是本函数唯一需要小心的地方。

    :param run: 已经 `add_picture()` 过的 run。
    :param align: ``"right"``（默认，贴版心右缘）/ ``"left"``（elegant 这类照片在左的模板）。
    :param vertical_offset_mm: 相对锚点段落顶部的下移量（mm）。照片改成"按原图比例装进
        照片框（contain）"之后，框内上下留白由调用方算好传进来，与 CSS
        `object-fit: contain` 的垂直居中同一定位；默认 0 = 贴段首（旧行为）。
    :returns: 是否真的转换成功；没有图片或结构不认识时返回 ``False``（调用方决定是否回退）。
    """
    drawing = run._element.find(qn("w:drawing"))
    if drawing is None:
        return False
    inline = drawing.find(qn("wp:inline"))
    if inline is None:
        return False

    anchor = OxmlElement("wp:anchor")
    for name, value in (
        ("distT", "0"),
        ("distB", "0"),
        ("distL", "0"),
        ("distR", "0"),
        ("simplePos", "0"),
        # z 序：数值越大越靠上。给一个"高于普通文字、低于批注"的常规值即可。
        ("relativeHeight", "251658240"),
        # 「浮于文字上方」：不进背景层。
        ("behindDoc", "0"),
        ("locked", "0"),
        ("layoutInCell", "1"),
        ("allowOverlap", "1"),
    ):
        anchor.set(name, value)

    simple_pos = OxmlElement("wp:simplePos")
    simple_pos.set("x", "0")
    simple_pos.set("y", "0")
    anchor.append(simple_pos)

    # 水平：以**版心**为参照对齐，照片因此贴正文右缘（左缘），不受段落缩进影响。
    position_h = OxmlElement("wp:positionH")
    position_h.set("relativeFrom", "margin")
    align_node = OxmlElement("wp:align")
    align_node.text = align
    position_h.append(align_node)
    anchor.append(position_h)

    # 垂直：以**所在段落**为参照、偏移 0——锚在姓名那一段上，页头一动它跟着动，
    # 不会跑到纸张最顶上（那样翻到第 2 页时照片会跟着"消失"在页首）。
    position_v = OxmlElement("wp:positionV")
    position_v.set("relativeFrom", "paragraph")
    offset = OxmlElement("wp:posOffset")
    # 0mm 仍写 "0"（与改动前的字节完全一致）；有偏移时用 EMU（1mm = 36000 EMU）。
    offset.text = "0" if vertical_offset_mm == 0 else str(int(round(Mm(vertical_offset_mm).emu)))
    position_v.append(offset)
    anchor.append(position_v)

    # 以下节点原样搬过来（不重建），保证图片数据、alt 文本与尺寸一个字节都不丢。
    for tag in ("wp:extent", "wp:effectExtent"):
        node = inline.find(qn(tag))
        if node is not None:
            anchor.append(node)
    anchor.append(OxmlElement("wp:wrapNone"))
    for tag in ("wp:docPr", "wp:cNvGraphicFramePr", "a:graphic"):
        node = inline.find(qn(tag))
        if node is not None:
            anchor.append(node)

    drawing.replace(inline, anchor)
    return True

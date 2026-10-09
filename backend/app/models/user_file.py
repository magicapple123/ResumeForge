"""用户文件副本：数据库内 base64 用户文件在磁盘上的一份镜像登记。

内容本身**不在表里**：同一份内容按 ``sha256`` 去重后落盘在
``<数据库同目录>/user_files/``（见 ``services/user_files.py``），这张表只登记
元信息与来源。来源（``source_type``/``source_ref``）记的是首次保存时的那一条；
之后其它入口再保存同一份内容时，新来源只并入 ``sources_json``，不新增行。
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class UserFile(Base):
    __tablename__ = "user_file"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 内容指纹（十六进制，64 字符）：去重判据。
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    # 服务端生成的落盘名（<sha 前 16 位>-<安全化原名>），客户端不参与命名。
    disk_name: Mapped[str] = mapped_column(String(160))
    original_name: Mapped[str] = mapped_column(String(255), default="")
    mime: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    # 首次来源：material / photo / job_note / candidate_image / chat_attachment。
    source_type: Mapped[str] = mapped_column(String(40), default="")
    source_ref: Mapped[str] = mapped_column(String(120), default="")
    # 全部来源：JSON 数组 [{"source_type": ..., "source_ref": ...}, ...]，去重追加。
    sources_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

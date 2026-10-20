# SPDX-License-Identifier: Apache-2.0
"""Deterministic binary blob builders (PNG / PDF / DOCX / tiny avatar).

Moved verbatim from the original script; the only change is that the random
sources now come from the run RNG passed as a parameter, so the functions
stay pure with respect to module state.
"""

from __future__ import annotations

import base64
import io
import random
import struct
import zipfile
import zlib


def tiny_png_data_url() -> str:
    """A 64x64 grayscale gradient PNG (a few KB) for photo/base64 fields."""
    width, height = 64, 64
    raw = bytearray()
    for _ in range(height):
        raw.append(0)
        raw += bytes((x * 4) % 256 for x in range(width * 3))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            chunk(b"IEND", b""),
        ]
    )
    return "data:image/png;base64," + base64.b64encode(png).decode()


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def make_png_bytes(rng: random.Random, target: int) -> bytes:
    """Noise PNG (compression ratio ~1, predictable size), padded with tEXt."""
    height = 320
    width = max(64, int(target * 0.75) // (3 * height + 1))
    raw = bytearray()
    for _ in range(height):
        raw.append(0)
        raw += rng.randbytes(3 * width)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    body = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            png_chunk(b"IHDR", ihdr),
            png_chunk(b"IDAT", zlib.compress(bytes(raw), 6)),
        ]
    )
    for _ in range(2):
        pad_needed = target - len(body) - 24
        if pad_needed <= 0:
            break
        payload = b"Comment\x00" + base64.b64encode(rng.randbytes(max(pad_needed * 3 // 4, 16)))
        body += png_chunk(b"tEXt", payload[: max(pad_needed - 12, 16)])
    return body + png_chunk(b"IEND", b"")


def make_pdf_bytes(rng: random.Random, title: str, pad_kb: float) -> bytes:
    """Minimal valid PDF (with xref); the content stream pads with comments."""
    filler = "\n".join(f"% pad {rng.randrange(10**9):09d}" for _ in range(int(pad_kb * 1024 / 16)))
    stream = f"BT /F1 12 Tf 72 770 Td ({title}) Tj ET\n{filler}\n"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream.encode())} >>\nstream\n{stream}endstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{obj}\nendobj\n".encode()
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode()
    return bytes(out)


def make_docx_bytes(paragraphs: int) -> bytes:
    """Build a minimal valid docx via zipfile."""
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.wordprocessingml.document.main+xml"/></Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    )
    body = "".join(
        f"<w:p><w:r><w:t>stress fictional paragraph {index}</w:t></w:r></w:p>"
        for index in range(paragraphs)
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document)
    return buffer.getvalue()

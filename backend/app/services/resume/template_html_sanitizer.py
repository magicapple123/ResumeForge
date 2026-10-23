# SPDX-License-Identifier: Apache-2.0
"""Single-pass tag filtering that preserves raw Jinja/HTML source in allowed tags."""

from html.parser import HTMLParser

_BLOCKED_TAGS = frozenset({"script", "iframe", "object", "embed", "base", "link"})
_BLOCKED_CONTAINERS = frozenset({"script", "iframe", "object"})


class _TemplateFilter(HTMLParser):
    def __init__(self, security_meta: str) -> None:
        super().__init__(convert_charrefs=False)
        self.security_meta = security_meta
        self.parts: list[str] = []
        self.suppressed: list[str] = []
        self.policy_inserted = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.suppressed:
            if tag == self.suppressed[-1] and tag in _BLOCKED_CONTAINERS:
                self.suppressed.append(tag)
            return
        if tag in _BLOCKED_TAGS:
            if tag in _BLOCKED_CONTAINERS:
                self.suppressed.append(tag)
            return
        if tag == "meta" and any(name.casefold() == "http-equiv" for name, _ in attrs):
            return  # Never allow a refresh or a template-provided policy override.
        # `get_starttag_text()` 的标注是 Optional（历史原因）；走到这里说明确实有开始
        # 标签文本，`or ""` 只是把这条保证写给类型检查。
        self.parts.append(self.get_starttag_text() or "")
        if tag == "head" and not self.policy_inserted:
            self.parts.append('\n<meta charset="utf-8" />\n' + self.security_meta + "\n")
            self.policy_inserted = True

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.suppressed or tag in _BLOCKED_TAGS:
            return
        if tag == "meta" and any(name.casefold() == "http-equiv" for name, _ in attrs):
            return
        self.parts.append(self.get_starttag_text() or "")

    def handle_endtag(self, tag: str) -> None:
        if self.suppressed:
            if tag == self.suppressed[-1]:
                self.suppressed.pop()
            return
        if tag not in _BLOCKED_TAGS:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.suppressed:
            self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.handle_data(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.handle_data(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        if not self.suppressed:
            self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        if not self.suppressed:
            self.parts.append(f"<!{decl}>")


def filter_template_html(source: str, security_meta: str) -> str:
    parser = _TemplateFilter(security_meta)
    parser.feed(source or "")
    parser.close()
    cleaned = "".join(parser.parts)
    if parser.policy_inserted:
        return cleaned
    # Fragments get an implicit HTML head in the browser. Preserve an initial doctype so
    # the fallback policy does not force a formerly standards-mode template into quirks mode.
    offset = cleaned.find(">") + 1 if cleaned.lstrip().lower().startswith("<!doctype") else 0
    return cleaned[:offset] + security_meta + "\n" + cleaned[offset:]

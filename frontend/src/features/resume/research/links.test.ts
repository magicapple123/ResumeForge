// SPDX-License-Identifier: Apache-2.0
/**
 * 链接安全（W14）：DOI / URL 只在 http(s) 时变成可点链接。
 *
 * 这一组用例守的是**投递产物之外的第二道门**：编辑界面里 user 手填的链接如果直接进 href，
 * 一个 javascript: 就能在预览 iframe 里执行。规则本身很短，所以要钉得细：
 * 协议白名单、无 host、控制字符、超长、DOI 形态，各一条。
 */
import { describe, expect, it } from "vitest";
import { MAX_LINK_LENGTH, doiHref, linkText, safeExternalHref } from "./links";

describe("safeExternalHref", () => {
  it("接受 http 与 https", () => {
    expect(safeExternalHref("https://example.com/paper?id=1")).toBe(
      "https://example.com/paper?id=1",
    );
    expect(safeExternalHref("http://example.com")).toBe("http://example.com/");
  });

  it("去掉首尾空白", () => {
    expect(safeExternalHref("  https://example.com/a  ")).toBe("https://example.com/a");
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<b>x</b>",
    "file:///etc/passwd",
    "mailto:a@example.com",
    "ftp://example.com/x",
  ])("拒绝非 http(s) 协议：%s", (raw) => {
    expect(safeExternalHref(raw)).toBeNull();
  });

  it("拒绝缺主机名/无法解析的地址", () => {
    // WHATWG 解析器会把 "http:///x" 的 host 补成 x，所以这里用真正解析不出的输入。
    expect(safeExternalHref("https://")).toBeNull();
    expect(safeExternalHref("http://")).toBeNull();
    expect(safeExternalHref("not a url")).toBeNull();
  });

  it("拒绝含空白或控制字符的输入（可能藏不可见前缀）", () => {
    expect(safeExternalHref("https://example.com/ a")).toBeNull();
    expect(safeExternalHref("https://example.com/\u0000")).toBeNull();
  });

  it("拒绝超长链接", () => {
    expect(safeExternalHref("https://example.com/" + "a".repeat(MAX_LINK_LENGTH))).toBeNull();
  });

  it("空值与非字符串一律 null（输入中的状态不是错误）", () => {
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref("   ")).toBeNull();
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
  });
});

describe("doiHref", () => {
  it("合法 DOI 解析成 doi.org 地址", () => {
    expect(doiHref("10.1000/xyz123")).toBe("https://doi.org/10.1000/xyz123");
  });

  it.each(["", "10.1000", "doi:10.1000/x", "https://doi.org/10.1/x", "10.1000/x y"])(
    "非法 DOI 不当链接：%s",
    (raw) => {
      expect(doiHref(raw)).toBeNull();
    },
  );
});

describe("linkText", () => {
  it("超长截断且保留可读前缀", () => {
    const text = linkText("https://example.com/" + "a".repeat(80));
    expect(text.length).toBe(48);
    expect(text.endsWith("…")).toBe(true);
  });

  it("短链接原样返回", () => {
    expect(linkText(" https://a.example ")).toBe("https://a.example");
    expect(linkText(null)).toBe("");
  });
});

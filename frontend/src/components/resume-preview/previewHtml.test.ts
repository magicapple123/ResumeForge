// SPDX-License-Identifier: Apache-2.0
/** Q22: preview iframes never receive the server-rendered pagination probe script. */
import { describe, expect, it } from "vitest";
import { stripPreviewScripts } from "./previewHtml";

const PROBE = '<script nonce="abc">window.addEventListener("load", () => {});</script>';

describe("stripPreviewScripts", () => {
  it("removes the probe script block but keeps the rest of the document", () => {
    const html = `<!doctype html><html><head><style>.a{color:red}</style></head><body><p data-resume-path="x">Hello</p>${PROBE}</body></html>`;
    const cleaned = stripPreviewScripts(html);
    expect(cleaned).not.toContain("<script");
    expect(cleaned).not.toContain("addEventListener");
    expect(cleaned).toContain('<p data-resume-path="x">Hello</p>');
    expect(cleaned).toContain(".a{color:red}");
  });

  it("leaves script-free documents untouched (same string, no allocation churn)", () => {
    const html = "<!doctype html><html><body><p>plain</p></body></html>";
    expect(stripPreviewScripts(html)).toBe(html);
  });

  it("removes every script block, including multi-line ones", () => {
    const html = `<body><script type="text/javascript">
      const a = 1;
      const b = 2;
    </script><div>ok</div><script>const c = 3;</script></body>`;
    const cleaned = stripPreviewScripts(html);
    expect(cleaned).toBe("<body><div>ok</div></body>");
  });
});

/**
 * 正则版本（`/<script\b[^>]*>[\s\S]*?<\/script>/gi`）挡不住的写法。
 * 这些用例钉的是「按 HTML 词法扫描」而不是「会写正则就敢清洗」：CodeQL
 * `js/bad-tag-filter`（标签过滤不全）与 `js/incomplete-multi-character-sanitization`
 * （一次替换后又能拼出新标签）报的就是这一类。
 */
describe("stripPreviewScripts: tag variants a regex cannot cover", () => {
  it("removes uppercase and mixed-case script tags", () => {
    expect(stripPreviewScripts("<body><SCRIPT>alert(1)</SCRIPT><p>ok</p></body>")).toBe(
      "<body><p>ok</p></body>",
    );
    expect(stripPreviewScripts("<body><SCRIPT>a</ScRiPt><p>ok</p></body>")).toBe(
      "<body><p>ok</p></body>",
    );
  });

  it("removes closing tags with whitespace before '>'", () => {
    // `</script >` / `</script\n>`：浏览器认，旧正则的 `</script>` 字面量不认。
    expect(stripPreviewScripts("<body><script>alert(1)</script ><p>ok</p></body>")).toBe(
      "<body><p>ok</p></body>",
    );
    expect(stripPreviewScripts("<body><script>alert(1)</script\n\t><p>ok</p></body>")).toBe(
      "<body><p>ok</p></body>",
    );
  });

  it("removes a self-closing script tag and keeps the document after it", () => {
    // `<script src=x />` 没有内容体也没有 `</script>`：只应删掉这一个标签，
    // 后面的内容不是脚本体（HTMLParser 同口径；浏览器把它当未闭合脚本，见下一条）。
    expect(stripPreviewScripts("<body><p>a</p><script src=x /><p>b</p></body>")).toBe(
      "<body><p>a</p>",
    );
    // 显式配对的 `</script>` 一定被吃掉：
    expect(stripPreviewScripts("<body><script src=x /></script><p>b</p></body>")).toBe(
      "<body><p>b</p></body>",
    );
  });

  it("removes an unclosed script block up to the end of the string", () => {
    // 未闭合按「删到结尾」处理：浏览器会把余下全文当脚本体，这里同向且更安全。
    expect(stripPreviewScripts("<body><p>keep</p><script>alert(1)")).toBe("<body><p>keep</p>");
    expect(stripPreviewScripts("<body><p>keep</p><script")).toBe("<body><p>keep</p>");
  });

  it("does not leave a live script tag behind after removing nested residue", () => {
    // `<scr<script>ipt>alert(1)</script>`：删掉内层后剩下 `<scr` + 尾巴，绝不能再拼出
    // 一个真的 `<script>`。
    const cleaned = stripPreviewScripts("<body><scr<script>ipt>alert(1)</script></body>");
    expect(cleaned).not.toContain("<script");
    expect(cleaned).toBe("<body><scr</body>");
  });

  it("rescans the result: deletion must not splice a new script tag together", () => {
    // 第一趟删掉中间段后，前后残片会拼成 `<script>alert(1)</script>`；
    // 单趟扫描会把它原样交出去——所以必须循环到「结果里没有 <script」。
    const html = "<scr<script>x</script>ipt>alert(1)</script>";
    const cleaned = stripPreviewScripts(html);
    expect(cleaned).not.toContain("<script");
    expect(cleaned).toBe("");
  });

  it("keeps every non-script byte identical (styles, data-*, @font-face)", () => {
    // 预览与导出同源：样式表、`data-resume-path`、内嵌字体一个字都不能变（所以这里
    // 不能走 DOMParser 往返——序列化会重排属性、改写自闭合标签）。
    const html =
      '<!doctype html><html><head><style>@font-face{font-family:X;src:url(data:font/woff2;base64,AAA)}.a>b{color:red}</style></head><body><p data-resume-path="education.ob_1.it_1">Hello</p><br/><img src="x.png" alt=""/><div class="sub-grid sub-cols-2">&amp;</div></body></html>';
    const withProbe = html.replace("</body>", `${PROBE}</body>`);
    expect(stripPreviewScripts(withProbe)).toBe(html);
    // 没有脚本的普通 HTML：同一个字符串值原样返回。
    expect(stripPreviewScripts(html)).toBe(html);
  });

  it("does not touch lookalike tags such as <scriptx> or <style>", () => {
    const html = "<body><scriptx>keep</scriptx><style>.a{}</style><p>ok</p></body>";
    expect(stripPreviewScripts(html)).toBe(html);
  });
});

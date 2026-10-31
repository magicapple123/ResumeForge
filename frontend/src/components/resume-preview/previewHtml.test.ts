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

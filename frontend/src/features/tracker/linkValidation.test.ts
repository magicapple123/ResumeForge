// SPDX-License-Identifier: Apache-2.0
/**
 * 关联链接的校验口径：**逐条**比对后端 `schemas.common.validate_http_url`。
 *
 * 这一条是安全边界，不是格式洁癖：链接会被渲染成 `<a href target="_blank">`，
 * 放行 `javascript:` 等于把用户输入变成可执行脚本；放行 `file:` 等于让页面读本地文件。
 * 前后端各写一份判定必然漂移，漂一次的表现是「表单说没问题、保存后 422」，或者
 * 更糟——前端放行了后端拒的东西，用户反复重试也找不到原因。
 */
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { MAX_TRACK_LINK_CHARS, trackLinkError } from "./linkValidation";

const VALID = "https://jobs.example.com/apply?utm_source=referral";
/** 2048 是后端 `String(2048)` 的列宽，测试里写死字面量是刻意的。 */
const BACKEND_LINK_COLUMN_CHARS = 2048;

describe("关联链接的校验口径", () => {
  it("放行 http / https 且有主机名的地址（含粘贴带来的首尾空格）", () => {
    expect(trackLinkError(VALID)).toBeNull();
    expect(trackLinkError(`  ${VALID}  `)).toBeNull();
    expect(trackLinkError("HTTP://Example.com/x")).toBeNull();
    expect(trackLinkError("http://192.168.1.10:8080/apply")).toBeNull();
  });

  it("空串合法：链接是选填，清空是正常动作", () => {
    expect(trackLinkError("")).toBeNull();
    expect(trackLinkError("   ")).toBeNull();
    expect(trackLinkError(undefined)).toBeNull();
  });

  it("只放行 http / https：可执行协议与本地协议一律拒", () => {
    const rejected = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "file:///etc/passwd",
      "ftp://a.example.com/x",
      "data:text/html,<b>x</b>",
      "mailto:hr@example.com",
    ];
    for (const value of rejected) {
      expect(trackLinkError(value)).toBe(t("trackerForm.error.linkProtocol"));
    }
  });

  it("没有主机名或没有协议：判无效，且不替用户补 https://", () => {
    // 补协议等于把"他填了什么"改掉；给一句具体的错误更诚实。
    expect(trackLinkError("example.com/apply")).toBe(t("trackerForm.error.linkInvalid"));
    expect(trackLinkError("http://")).toBe(t("trackerForm.error.linkInvalid"));
    expect(trackLinkError("https://?q=1")).toBe(t("trackerForm.error.linkInvalid"));
  });

  it("长度上限与后端列宽一致（2048），超一个字符就拒", () => {
    expect(MAX_TRACK_LINK_CHARS).toBe(BACKEND_LINK_COLUMN_CHARS);
    const prefix = "https://example.com/";
    const fits = prefix + "a".repeat(BACKEND_LINK_COLUMN_CHARS - prefix.length);
    expect(fits).toHaveLength(BACKEND_LINK_COLUMN_CHARS);
    expect(trackLinkError(fits)).toBeNull();
    expect(trackLinkError(`${fits}a`)).toBe(
      t("trackerForm.error.linkTooLong", { max: BACKEND_LINK_COLUMN_CHARS }),
    );
  });

  it("中文域名走 URL 的正常化，不算非法", () => {
    // 用户真的会填中文域名；`new URL` 会把它转成 punycode，协议与主机判定仍然成立。
    expect(trackLinkError("https://例子.中国/岗位")).toBeNull();
  });
});

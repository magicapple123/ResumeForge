// SPDX-License-Identifier: Apache-2.0
/**
 * 关联链接的校验：与后端 `schemas.common.validate_http_url` **同一口径**。
 *
 * 为什么单独成文件：判定要在两处被读（表单校验 + 测试逐条比对口径），而
 * `TrackFormModal.tsx` 只能导出组件——在那里多导出一个函数会让 Fast Refresh
 * 退化成整页刷新（同 `components/common/rowActionMenu.ts` 的取舍）。
 *
 * 规则四条，缺一条都能造成真实的坏结果：
 *
 * 1. **空串合法**：链接是选填，"清空"是用户的正常动作，不能判成错误；
 * 2. **只放行 http / https**：`javascript:` 是可执行脚本、`file:` 能读本地文件，
 *    它们会被渲染成 `<a href>`，等于把用户输入变成代码执行入口；
 * 3. **必须有主机名**：`https://` 这种地址前端拼不出来，点了也是死链；
 * 4. **长度不超过 2048**：与后端 `MAX_TRACK_LINK_CHARS` / `application_track.link`
 *    的列宽（`String(2048)`）逐字一致，别让用户等到 422 才知道超了。
 *
 * 刻意**不替用户补** `https://`：那会把他填的东西改成别的东西，给一句具体的错误更诚实。
 */
import { t } from "../../i18n";

/** 与后端 `MAX_TRACK_LINK_CHARS`、`application_track.link` 的列宽逐字一致。 */
export const MAX_TRACK_LINK_CHARS = 2048;

/**
 * 判定一个用户填的链接能不能提交。
 *
 * Args:
 *   value: 表单里的原始字符串，可为空。
 *
 * Returns:
 *   `null` 表示通过；否则返回要显示在字段下方的文案（已按当前语言求值）。
 */
export function trackLinkError(value: string | undefined): string | null {
  // 粘贴来的链接常带首尾空格与换行，判定与提交都以 trim 后的值为准。
  const cleaned = (value ?? "").trim();
  if (!cleaned) return null;
  if (cleaned.length > MAX_TRACK_LINK_CHARS) {
    return t("trackerForm.error.linkTooLong", { max: MAX_TRACK_LINK_CHARS });
  }
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    // 没有 scheme（"example.com/apply"）或主机缺失（"https://"）都落在这里。
    return t("trackerForm.error.linkInvalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return t("trackerForm.error.linkProtocol");
  }
  if (!parsed.hostname) return t("trackerForm.error.linkInvalid");
  return null;
}

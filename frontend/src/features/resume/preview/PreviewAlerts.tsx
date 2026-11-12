// SPDX-License-Identifier: Apache-2.0
/**
 * 纸张上方的两条提示：**渲染警告**（字体缺字、图片过大等）与**溢出提示**
 * （按当前设置约需几页 / 超了多少）。
 *
 * 为什么单独成文件、并且由 `ResumePreview` 渲染在**纸张区域之外**：
 * 制作台把"工具条 + 这两条提示"当作固定头部、只有纸面滚动（2026-10-29 用户要求
 * "上下滑动时红框部分都不要动"）。它们原先长在 `ResumePreviewCanvas` 里，
 * 也就是跟纸面同一个滚动容器——一滚就跟着走。抽出来之后两个宿主共用同一份实现：
 * 预览弹窗仍按原顺序排在纸上方，制作台则把它们钉在头部。
 */
import { Alert, Button } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { UNLIMITED_PAGE_LIMIT } from "../../../types";
import { APPROXIMATE_PAGINATION_NOTE_KEY, OVERFLOW_NOTE_KEY, type PreviewMode } from "./config";

interface Props {
  warnings: string[];
  overflow: boolean;
  /** 溢出内容被裁掉（1 页上限）而不是排成第二页：决定提示里说哪一句话。 */
  overflowClipped: boolean;
  pagesNeeded: number;
  /** 用户设定的篇幅上限。**`0` = 不限篇幅**（不是"没设定"）。 */
  pageLimit: number;
  overflowAmountText: string;
  /**
   * 当前预览口径。**精确模式下不渲染溢出那条**（渲染警告不受影响）。
   *
   * 精确那一栏的页数结论来自服务端排出的真实 PDF（`ExactPreviewAlerts`），而这里的
   * `overflow` / `pagesNeeded` 来自草稿画布的浏览器分页。两套引擎算出 6 页和 5 页是常态，
   * 同时挂着就是**同屏两条页数提醒**（2026-10-29 用户截图：5 页、6 页各一条）。
   * 精确模式下草稿画布仍在后台排版（只为测量，见 `ResumePreview` 的 `measuringOnly`），
   * 所以不按口径主动关掉它，它就会一直重复报同一件事。
   */
  mode?: PreviewMode;
}

export default function PreviewAlerts({
  warnings,
  overflow,
  overflowClipped,
  pagesNeeded,
  pageLimit,
  overflowAmountText,
  mode = "draft",
}: Props) {
  useLocale();
  /**
   * 渲染警告默认折叠（2026-11 问题 8 方案 A 2b）：
   *
   * 4 条 bullet 全展开时这一块占 ≈180px，是首屏里最大的一块。**标题与条数常驻**（这是
   * 警告，"还有 4 条要核对"必须一直在视野里），只有正文收起来——与「未收录 31 条」那种
   * 纯信息不同，它不能退化成灰色数字，所以保留 Alert 的琥珀外观。
   */
  const [warningsOpen, setWarningsOpen] = useState(false);
  // 不限篇幅 → 没有"上限"这回事，溢出告警整条不渲染：否则会说"约需 2 页（上限 1 页）…
  // 第 2 页起不计入导出"，而导出其实一个字节都没裁（渲染警告不受影响，那是另一件事）。
  const showOverflowAlert = overflow && pageLimit !== UNLIMITED_PAGE_LIMIT && mode !== "exact";
  if (warnings.length === 0 && !showOverflowAlert) return null;
  return (
    <div className="resume-preview-alerts">
      {warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={t("preview.canvas.warningsTitle")}
          // 默认不渲染正文（不是"渲染了再隐藏"）：4 条 bullet 曾经把纸面挤出首屏。
          description={
            warningsOpen ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : undefined
          }
          // 展开 / 收起的按钮带条数：读屏与视觉都能读到"还有几条没看"。
          action={
            <Button size="small" type="text" onClick={() => setWarningsOpen((open) => !open)}>
              {warningsOpen
                ? t("preview.canvas.warningsCollapse")
                : t("preview.canvas.warningsExpand", { count: warnings.length })}
            </Button>
          }
        />
      )}
      {showOverflowAlert && (
        <Alert
          type="warning"
          showIcon
          className="resume-preview-overflow"
          // 措辞只说事实（约需几页、超了多少），**不再说"字号已降到最小"**：2026-10-21
          // 起不再自动缩字号，装不下就是装不下，改法由用户决定（加页 / 收紧排版 / 删内容）。
          title={t("exact.overflow.title", { needed: pagesNeeded, limit: pageLimit })}
          description={t("preview.canvas.overflowBody", {
            amount: overflowAmountText,
            // 2026-11-02（问题 2）：超限的页现在**照样画出来**，所以这段说明要说清
            // "全部 N 页都显示了、第 M 页起不计入导出"。两个数字必须由这一层给：
            // `pagesNeeded` / `pageLimit` 已经是同一份 `resolvePageCounts` 的结果。
            note: t(overflowClipped ? OVERFLOW_NOTE_KEY : APPROXIMATE_PAGINATION_NOTE_KEY, {
              pages: Math.max(pageLimit, pagesNeeded),
              from: pageLimit + 1,
            }),
          })}
        />
      )}
    </div>
  );
}

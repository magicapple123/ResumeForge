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
import { Alert } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { APPROXIMATE_PAGINATION_NOTE_KEY, OVERFLOW_NOTE_KEY, type PreviewMode } from "./config";

interface Props {
  warnings: string[];
  overflow: boolean;
  /** 溢出内容被裁掉（1 页上限）而不是排成第二页：决定提示里说哪一句话。 */
  overflowClipped: boolean;
  pagesNeeded: number;
  pageCount: number;
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
  pageCount,
  overflowAmountText,
  mode = "draft",
}: Props) {
  useLocale();
  const showOverflowAlert = overflow && mode !== "exact";
  if (warnings.length === 0 && !showOverflowAlert) return null;
  return (
    <div className="resume-preview-alerts">
      {warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={t("preview.canvas.warningsTitle")}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
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
          title={t("exact.overflow.title", { needed: pagesNeeded, limit: pageCount })}
          description={t("preview.canvas.overflowBody", {
            amount: overflowAmountText,
            note: t(overflowClipped ? OVERFLOW_NOTE_KEY : APPROXIMATE_PAGINATION_NOTE_KEY),
          })}
        />
      )}
    </div>
  );
}

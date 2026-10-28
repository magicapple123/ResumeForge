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
import { APPROXIMATE_PAGINATION_NOTE_KEY, OVERFLOW_NOTE_KEY } from "./config";

interface Props {
  warnings: string[];
  overflow: boolean;
  /** 溢出内容被裁掉（1 页上限）而不是排成第二页：决定提示里说哪一句话。 */
  overflowClipped: boolean;
  pagesNeeded: number;
  pageCount: number;
  overflowAmountText: string;
}

export default function PreviewAlerts({
  warnings,
  overflow,
  overflowClipped,
  pagesNeeded,
  pageCount,
  overflowAmountText,
}: Props) {
  useLocale();
  if (warnings.length === 0 && !overflow) return null;
  return (
    <div className="resume-preview-alerts">
      {warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
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
      {overflow && (
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

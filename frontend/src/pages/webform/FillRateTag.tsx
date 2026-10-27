// SPDX-License-Identifier: Apache-2.0
/**
 * 一键填充成功率：按「成功填写 / 页面表单控件总数」计。
 * （自 WebFormPage 拆出，逐字搬运。）
 */
import { Tag } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function FillRateTag({ filled, total }: { filled: number; total?: number }) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这枚标签不重渲染。
  useLocale();
  if (!total || total <= 0) return null;
  return (
    <Tag color="processing">
      {t("webFormPage.fillRate.label", {
        percent: Math.round((filled * 100) / total),
        filled,
        total,
      })}
    </Tag>
  );
}

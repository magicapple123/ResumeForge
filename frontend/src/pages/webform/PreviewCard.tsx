// SPDX-License-Identifier: Apache-2.0
/**
 * 预览与填充（结果区「预览与填充」标签页的内容）：勾选要填的项、手改值、采纳 AI 建议、
 * 填充到页面。
 *
 * I-11：去掉 `Card` 外壳——分组由外层 `ResultPanel` 的 Tabs 承担，再套一层卡片就是
 * 「结果区里还并排着三张卡」。标题与两个动作压成一行表头，表格直接铺开。
 */
import { Button, Space, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import EmptyState from "../../components/common/EmptyState";
import WebFormPreviewTable from "../../features/webform/WebFormPreviewTable";
import type { WebFormPreview } from "../../types";
import type { WebFormBusyState } from "./constants";

export function PreviewCard({
  preview,
  selected,
  values,
  aiSuggestions,
  busy,
  running,
  onSelectAiSuggestions,
  onFill,
  onToggle,
  onValueChange,
  sampleLocked = false,
}: {
  preview: WebFormPreview;
  selected: Set<number>;
  values: Record<number, string>;
  aiSuggestions: WebFormPreview["items"];
  busy: WebFormBusyState;
  running: boolean;
  onSelectAiSuggestions: () => void;
  onFill: () => void;
  onToggle: (index: number) => void;
  onValueChange: (index: number, value: string) => void;
  /** 当前数据集是「体验示例」：这张表只是演示，不允许写进真实页面。 */
  sampleLocked?: boolean;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <div className="webform-preview">
      <div className="webform-preview-header">
        <span className="webform-preview-title">
          {t("webFormPage.previewCard.title", {
            selected: selected.size,
            total: preview.items.length,
          })}
        </span>
        <div className="webform-preview-actions">
          {/* AI 建议默认不勾——失败形态是"我忘了勾"，而不是"悄悄写了个错值"。
              想一次全采纳，这里点一下就好。 */}
          {aiSuggestions.length ? (
            <Button onClick={onSelectAiSuggestions} disabled={busy === "fill"}>
              {t("webFormPage.previewCard.selectAi", { count: aiSuggestions.length })}
            </Button>
          ) : null}
          <Space size="small">
            <Button
              type="primary"
              loading={busy === "fill"}
              disabled={!running || selected.size === 0 || sampleLocked}
              onClick={onFill}
            >
              {t("webFormPage.previewCard.fill")}
            </Button>
          </Space>
        </div>
      </div>
      {sampleLocked ? (
        <Typography.Text type="warning" className="webform-flow-reason">
          {t("webFormPage.sampleLocked.hint")}
        </Typography.Text>
      ) : null}
      {preview.items.length ? (
        <WebFormPreviewTable
          items={preview.items}
          selected={selected}
          values={values}
          disabled={busy === "fill"}
          onToggle={onToggle}
          onValueChange={onValueChange}
        />
      ) : (
        <EmptyState description={t("webFormPage.previewCard.empty")} />
      )}
    </div>
  );
}

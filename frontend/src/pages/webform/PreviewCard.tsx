// SPDX-License-Identifier: Apache-2.0
/**
 * 预览核对卡：勾选要填的项、手改值、采纳 AI 建议、填充到页面。
 * （自 WebFormPage 拆出：:947-984 整块逐字随迁，纯 props。）
 */
import { Button, Card, Space } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import EmptyState from "../../components/common/EmptyState";
import WebFormPreviewTable from "../../components/webform/WebFormPreviewTable";
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
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这张卡不重渲染。
  useLocale();
  return (
    <Card
      size="small"
      title={t("webFormPage.previewCard.title", {
        selected: selected.size,
        total: preview.items.length,
      })}
      extra={
        <Space size="small">
          {/* AI 建议默认不勾——失败形态是"我忘了勾"，而不是"悄悄写了个错值"。
              想一次全采纳，这里点一下就好。 */}
          {aiSuggestions.length ? (
            <Button onClick={onSelectAiSuggestions} disabled={busy === "fill"}>
              {t("webFormPage.previewCard.selectAi", { count: aiSuggestions.length })}
            </Button>
          ) : null}
          <Button
            type="primary"
            loading={busy === "fill"}
            disabled={!running || selected.size === 0}
            onClick={onFill}
          >
            {t("webFormPage.previewCard.fill")}
          </Button>
        </Space>
      }
    >
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
    </Card>
  );
}

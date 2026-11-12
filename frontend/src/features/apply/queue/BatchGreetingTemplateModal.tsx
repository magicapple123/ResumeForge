// SPDX-License-Identifier: Apache-2.0
/**
 * 「批量套用模板」（#14D）：勾选多条队列条目后，一次把同一条话术模板渲染进每一条。
 *
 * 变量按**各自的条目**渲染（每家公司/岗位不同），所以预览只展示第一条的样子，
 * 正文里明确写"变量按各自条目渲染"。逐条 PATCH，`allSettled` 聚合账目——一条失败
 * 不拖垮整批（与批量移出同一口径）。
 */
import { Button, Modal, Select, Space, Typography, App } from "antd";
import { useState } from "react";
import { updateQueueItem } from "../../../api/apply";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ApplyQueueItem } from "../../../types";
import { greetingValuesOf, renderGreetingTemplate } from "./greetingTemplate";
import { useGreetingTemplates } from "./useGreetingTemplates";

export function BatchGreetingTemplateModal({
  open,
  items,
  onClose,
  onApplied,
}: {
  open: boolean;
  /** 勾选的条目（>=1 才会打开）。 */
  items: ApplyQueueItem[];
  onClose: () => void;
  /** 套用结束后通知调用方刷新队列。 */
  onApplied: () => void;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后弹窗停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const { templates, loading } = useGreetingTemplates();
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const selected = templates.find((template) => String(template.id) === chosen);
  const first = items[0] ?? null;
  const preview =
    selected && first ? renderGreetingTemplate(selected.body, greetingValuesOf(first)) : "";

  const apply = async () => {
    if (!selected) {
      message.warning(t("applyQueue.template.batchEmpty"));
      return;
    }
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        items.map((item) =>
          updateQueueItem(item.id, {
            greeting: renderGreetingTemplate(selected.body, greetingValuesOf(item)),
          }),
        ),
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) {
        message.warning(
          t("applyQueue.template.batchPartial", { ok: items.length - failed, failed }),
        );
      } else {
        message.success(t("applyQueue.template.batchDone", { count: items.length }));
      }
      onApplied();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("applyQueue.template.batchTitle", { count: items.length })}
      onCancel={onClose}
      // 有写入请求：禁掉蒙层关闭，避免点到外面就丢掉正在进行的批量写入。
      mask={{ closable: false }}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t("common.action.cancel")}
        </Button>,
        <Button
          key="apply"
          type="primary"
          loading={busy}
          disabled={!selected}
          onClick={() => void apply()}
        >
          {t("applyQueue.template.batchApply")}
        </Button>,
      ]}
    >
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("applyQueue.template.batchBody")}
        </Typography.Paragraph>
        <Select
          style={{ width: "100%" }}
          allowClear
          showSearch
          optionFilterProp="label"
          loading={loading}
          placeholder={t("applyQueue.template.pickPlaceholder")}
          aria-label={t("applyQueue.template.pick")}
          value={chosen}
          options={templates.map((template) => ({
            value: String(template.id),
            label: template.name,
          }))}
          onChange={(value: string | undefined) => setChosen(value)}
        />
        {selected && (
          <Typography.Text type="secondary">
            {t("applyQueue.template.preview", { text: preview })}
          </Typography.Text>
        )}
      </Space>
    </Modal>
  );
}

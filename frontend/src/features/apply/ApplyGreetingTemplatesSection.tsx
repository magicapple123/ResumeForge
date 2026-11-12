// SPDX-License-Identifier: Apache-2.0
/**
 * 话术库（#14D）：模板的增删改，保存走 `PUT /apply/greeting-templates`（整份覆盖）。
 *
 * 存储在后端 `AppSetting` 的 JSON 数组里（零迁移），所以这里没有"编辑某一条"的细粒度端点：
 * 编辑全部在本地数组里做，点「保存话术库」一次提交整份。首版**只累计使用次数**，
 * 不做"哪套话术面试率高"（那依赖 14C 的联动数据，详情册明确标为"待积累"）。
 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Input, Space, Typography } from "antd";
import { useState } from "react";
import { getGreetingTemplates, saveGreetingTemplates } from "../../api/applyExtras";
import { useApi } from "../../hooks/useApi";
import EmptyState from "../../components/common/EmptyState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { GreetingTemplate, GreetingTemplateList } from "../../types";

/** 新模板的本地 id：后端只把它当成数组里的键，落库时原样保存。 */
function newTemplateId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ApplyGreetingTemplatesSection() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const { data, loading, error } = useApi<GreetingTemplateList>(getGreetingTemplates, []);
  const [rows, setRows] = useState<GreetingTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  // 渲染期镜像同步：接口回包只灌一次（与屏蔽清单同一模式）。
  const [source, setSource] = useState<GreetingTemplateList | null>(null);
  if (data && data !== source) {
    setSource(data);
    setRows(data.templates);
  }

  const updateRow = (index: number, patch: Partial<GreetingTemplate>) => {
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  };

  const addRow = () => {
    setRows((current) => [
      ...current,
      { id: newTemplateId(), name: "", body: "", tags: [], uses: 0 },
    ]);
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, position) => position !== index));
  };

  const save = async () => {
    // 空名/空正文就地拦下：存进去之后在编辑器里是一条选不出效果的模板。
    if (rows.some((row) => row.name.trim().length === 0)) {
      message.warning(t("applySettings.templates.needName"));
      return;
    }
    if (rows.some((row) => row.body.trim().length === 0)) {
      message.warning(t("applySettings.templates.needBody"));
      return;
    }
    setSaving(true);
    try {
      await saveGreetingTemplates(
        rows.map((row) => ({ ...row, name: row.name.trim(), body: row.body.trim() })),
      );
      message.success(t("applySettings.templates.saved"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applySettings.templates.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <LoadingBlock />;

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t("applySettings.templates.intro")}
      </Typography.Paragraph>
      {error && (
        <Typography.Text type="danger">{t("applySettings.templates.loadFailed")}</Typography.Text>
      )}
      {rows.length === 0 ? (
        <EmptyState inline description={t("applySettings.templates.empty")} />
      ) : (
        rows.map((row, index) => (
          <div className="apply-template-row" key={String(row.id)}>
            <Space size={6} wrap>
              <Input
                value={row.name}
                style={{ width: 200 }}
                placeholder={t("applySettings.templates.namePlaceholder")}
                aria-label={t("applySettings.templates.name")}
                onChange={(event) => updateRow(index, { name: event.target.value })}
              />
              <Typography.Text type="secondary">
                {t("applySettings.templates.uses", { count: row.uses })}
              </Typography.Text>
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={t("applySettings.templates.remove")}
                onClick={() => removeRow(index)}
              />
            </Space>
            <Input.TextArea
              rows={3}
              value={row.body}
              placeholder={t("applySettings.templates.bodyPlaceholder")}
              aria-label={t("applySettings.templates.body")}
              onChange={(event) => updateRow(index, { body: event.target.value })}
            />
          </div>
        ))
      )}
      <Space>
        <Button icon={<PlusOutlined />} onClick={addRow}>
          {t("applySettings.templates.add")}
        </Button>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          {t("applySettings.templates.save")}
        </Button>
      </Space>
    </Space>
  );
}

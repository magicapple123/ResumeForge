// SPDX-License-Identifier: Apache-2.0
/**
 * 话术库（#14D）：模板的增删改，保存走 `PUT /apply/greeting-templates`（整份覆盖）。
 *
 * 存储在后端 `AppSetting` 的 JSON 数组里（零迁移），所以这里没有"编辑某一条"的细粒度端点：
 * 编辑全部在本地数组里做，点「保存话术库」一次提交整份。首版**只累计使用次数**，
 * 不做"哪套话术面试率高"（那依赖 14C 的联动数据，详情册明确标为"待积累"）。
 *
 * 2026-11-17 起默认**只读**：模板是"存起来复用"的东西，日常打开这一页是来挑一条改，
 * 不是来批量重写。所以每行只显示名称 + 两行正文 + 用过几次，点「编辑」才在**原位**
 * 展开输入框，且一次只展开一条（并排展开会让两段长正文互相挤）。
 *
 * 保存时**不带 `uses`**：整表 PUT 是绝对值写入，带上本地读到的旧计数会把别处（队列里的
 * 套用）刚累加的值覆盖掉。计数只走 `POST /greeting-templates/{id}/use`。
 */
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Input, Space, Tooltip, Typography } from "antd";
import { useState } from "react";
import { getGreetingTemplates, saveGreetingTemplates } from "../../api/applyExtras";
import { useApi } from "../../hooks/useApi";
import EmptyState from "../../components/common/EmptyState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { GreetingTemplate, GreetingTemplateList } from "../../types";
import "./applySettingsSections.css";

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
  // 当前展开编辑的那一条（同一时刻最多一条）。
  const [editingId, setEditingId] = useState<string | null>(null);
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
    const row: GreetingTemplate = { id: newTemplateId(), name: "", body: "", tags: [], uses: 0 };
    setRows((current) => [...current, row]);
    // 新建后自动展开：否则用户点完「新建模板」只多出一行"空名字"，还得再点一次编辑。
    setEditingId(String(row.id));
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
      const saved = await saveGreetingTemplates(
        // 逐条挑字段而不是 `...row`：把 `uses` 一起发回去会覆盖掉队列里刚累计的计数。
        rows.map((row) => ({
          id: row.id,
          name: row.name.trim(),
          body: row.body.trim(),
          tags: row.tags,
        })),
      );
      setRows(saved.templates);
      setEditingId(null);
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
        rows.map((row, index) => {
          const rowKey = String(row.id);
          const editing = editingId === rowKey;
          return (
            <div className="apply-template-row" key={rowKey}>
              {editing ? (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  <Input
                    value={row.name}
                    style={{ width: 240 }}
                    placeholder={t("applySettings.templates.namePlaceholder")}
                    aria-label={t("applySettings.templates.name")}
                    onChange={(event) => updateRow(index, { name: event.target.value })}
                  />
                  <Input.TextArea
                    rows={4}
                    value={row.body}
                    placeholder={t("applySettings.templates.bodyPlaceholder")}
                    aria-label={t("applySettings.templates.body")}
                    onChange={(event) => updateRow(index, { body: event.target.value })}
                  />
                  <div>
                    <Button size="small" onClick={() => setEditingId(null)}>
                      {t("applySettings.templates.collapse")}
                    </Button>
                  </div>
                </Space>
              ) : (
                <>
                  <div className="apply-template-summary">
                    <Typography.Text strong className="apply-template-summary-name">
                      {row.name}
                    </Typography.Text>
                    <Typography.Text type="secondary" className="apply-template-uses">
                      {t("applySettings.templates.uses", { count: row.uses })}
                    </Typography.Text>
                    <Space size={2}>
                      <Tooltip title={t("applySettings.templates.edit")}>
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          aria-label={t("applySettings.templates.edit")}
                          onClick={() => setEditingId(rowKey)}
                        />
                      </Tooltip>
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        aria-label={t("applySettings.templates.remove")}
                        onClick={() => removeRow(index)}
                      />
                    </Space>
                  </div>
                  <Typography.Paragraph
                    type="secondary"
                    className="apply-template-body"
                    style={{ marginBottom: 0 }}
                  >
                    {row.body}
                  </Typography.Paragraph>
                </>
              )}
            </div>
          );
        })
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

// SPDX-License-Identifier: Apache-2.0
/**
 * 助手技能{t("skills.breadcrumb")}：创建、导入和管理助手技能。
 *
 * 「技能」= 一段长期生效的提示词 + 若干知识文件。它改变的是助手怎么回答问题，
 * 所以这一页的重点不是"管理列表"，而是让用户明白自己能造出什么样的助手。
 */
import { DeleteOutlined, EditOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import LoadingBlock from "../components/common/LoadingBlock";
import type { TableColumnsType } from "antd";
import type { HTMLAttributes } from "react";
import { useState } from "react";
import { useApi } from "../hooks/useApi";
import ErrorState from "../components/common/ErrorState";
import { deleteSkill, importSkill, listSkills, setSkillEnabled } from "../api/skill";
import { RowActions, RowContextMenu } from "../components/common/RowActions";
import SkillEditorModal, { type SkillDraft } from "../components/skills/SkillEditorModal";
import TemplateWorkbench from "../components/templates/TemplateWorkbench";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import type { AssistantSkill } from "../types";
import { formatDateTime } from "../utils/format";

/** 内置模板：给"不知道技能能写成什么样"的用户一个可直接改的起点。 */
const SKILL_TEMPLATES: { label: string; hint: string; draft: SkillDraft }[] = [
  {
    label: "简历要点精炼",
    hint: "把经历压成 3 条以内的简历要点",
    draft: {
      name: "简历要点精炼",
      description: "用户贴出一段经历、要求改写成简历要点时使用",
      prompt: [
        "改写简历要点时遵守以下要求：",
        "1. 每条不超过 35 个汉字，以强动作动词开头；",
        "2. 只重组用户给出的事实，不虚构数据、技能、奖项或结果；",
        "3. 一段经历最多输出 3 条要点，优先保留能体现影响力和技术难度的内容；",
        "4. 输出后附一行「事实来源」，说明每条要点对应原文的哪一部分；",
        "5. 如果原文缺少结果信息，直接问用户补一句，不要自己编。",
      ].join("\n"),
    },
  },
  {
    label: "面试问题预测",
    hint: "按岗位 JD 预测面试问题并给出回答思路",
    draft: {
      name: "面试问题预测",
      description: "用户准备面试、要求模拟提问时使用",
      prompt: [
        "预测面试问题时：",
        "1. 先从岗位 JD 里挑出 3 个最关键的能力要求，说明为什么它重要；",
        "2. 每个能力给出 2 个可能被问到的问题，区分「项目细节类」与「思路考察类」；",
        "3. 每个问题给出回答框架（要讲哪几点、用什么例子），不要替用户编造具体经历；",
        "4. 最后指出用户资料里最可能被追问的薄弱点，并给出补救建议。",
      ].join("\n"),
    },
  },
  {
    label: "岗位匹配分析",
    hint: "对照 JD 与资料说明匹配点、差距与补强建议",
    draft: {
      name: "岗位匹配分析",
      description: "用户问「这个岗位我能不能投」「匹配度如何」时使用",
      prompt: [
        "做岗位匹配分析时：",
        "1. 先列出 JD 的硬性要求（学历、年限、必备技能），逐条标注「已具备 / 部分具备 / 缺失」，并引用用户资料中的证据；",
        "2. 再评估加分项与方向契合度，说明哪些经历值得在简历里往前放；",
        "3. 对缺失项给出可执行的补强建议（学什么、做什么项目、怎么在简历里弱化）；",
        "4. 最后给一句明确结论：建议投递 / 谨慎投递 / 建议先补强，并说明理由。",
      ].join("\n"),
    },
  },
];

const ACCEPT = ".md,.zip";

export default function SkillsPage() {
  useLocale();
  const { message } = App.useApp();
  const [tab, setTab] = useState<"skills" | "templates">("skills");
  const { data, loading, error, reload: load, setData: setSkills } = useApi(listSkills);
  const skills = data ?? [];
  const [importing, setImporting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSkillId, setEditorSkillId] = useState<number | null>(null);
  const [editorDraft, setEditorDraft] = useState<SkillDraft | null>(null);

  const toggle = async (skill: AssistantSkill, enabled: boolean) => {
    if (togglingId !== null) return;
    setTogglingId(skill.id);
    try {
      const updated = await setSkillEnabled(skill.id, enabled);
      setSkills((current) =>
        (current ?? []).map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("skills.toast.toggleFailed"));
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async (skill: AssistantSkill) => {
    try {
      await deleteSkill(skill.id);
      message.success(t("skills.toast.deleted", { name: skill.name }));
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("skills.toast.deleteFailed"));
    }
  };

  const importFile = async (file: File) => {
    if (importing) return;
    setImporting(true);
    try {
      const saved = await importSkill(file);
      message.success(t("skills.toast.imported", { name: saved.name }));
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("skills.toast.importFailed"));
    } finally {
      setImporting(false);
    }
  };

  const openCreate = (draft: SkillDraft | null = null) => {
    setEditorSkillId(null);
    setEditorDraft(draft);
    setEditorOpen(true);
  };

  const openEditor = (skill: AssistantSkill) => {
    setEditorSkillId(skill.id);
    setEditorDraft(null);
    setEditorOpen(true);
  };

  const actionsFor = (skill: AssistantSkill) => [
    {
      key: "view",
      label: t("skills.action.view"),
      icon: <EditOutlined />,
      onClick: () => openEditor(skill),
    },
    {
      key: "delete",
      label: t("skills.action.delete"),
      danger: true,
      icon: <DeleteOutlined />,
      confirm: t("skills.confirm.delete", { name: skill.name }),
      onClick: () => void remove(skill),
    },
  ];

  const columns: TableColumnsType<AssistantSkill> = [
    {
      title: t("skills.column.skill"),
      dataIndex: "name",
      render: (_, skill) => (
        <Space orientation="vertical" size={0}>
          <Button type="link" className="table-text-link" onClick={() => openEditor(skill)}>
            {skill.name}
          </Button>
          {skill.description && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {skill.description}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t("skills.column.enabled"),
      key: "enabled",
      width: 90,
      render: (_, skill) => (
        <Switch
          aria-label={
            skill.enabled
              ? t("skills.aria.disable", { name: skill.name })
              : t("skills.aria.enable", { name: skill.name })
          }
          size="small"
          checked={skill.enabled}
          loading={togglingId === skill.id}
          onChange={(checked) => void toggle(skill, checked)}
        />
      ),
    },
    {
      title: t("skills.column.prompt"),
      dataIndex: "prompt_chars",
      width: 110,
      render: (value: number) => t("skills.column.promptLength", { count: value }),
    },
    {
      title: t("skills.column.files"),
      dataIndex: "files",
      width: 200,
      render: (files: string[]) =>
        files.length === 0 ? (
          <Typography.Text type="secondary">{t("skills.none")}</Typography.Text>
        ) : (
          <Tooltip title={files.join(" / ")}>
            <Tag>{t("skills.fileCount", { count: files.length })}</Tag>
          </Tooltip>
        ),
    },
    {
      title: t("skills.column.source"),
      dataIndex: "source_name",
      width: 140,
      render: (value: string) => value || "-",
    },
    {
      title: t("skills.column.updatedAt"),
      dataIndex: "updated_at",
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("skills.column.actions"),
      key: "actions",
      width: 120,
      render: (_, skill) => <RowActions more={actionsFor(skill)} />,
    },
  ];

  return (
    <div className="workbench-page">
      <div className="profile-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            工作台
          </Typography.Title>
          <Typography.Text type="secondary">{t("skills.page.subtitle")}</Typography.Text>
        </div>
        {tab === "skills" && (
          <Space>
            <Upload
              accept={ACCEPT}
              showUploadList={false}
              disabled={importing}
              beforeUpload={(file) => {
                void importFile(file as File);
                return Upload.LIST_IGNORE;
              }}
            >
              <Button icon={<UploadOutlined />} loading={importing}>
                {t("skills.action.import")}
              </Button>
            </Upload>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
              {t("skills.action.create")}
            </Button>
          </Space>
        )}
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as "skills" | "templates")}
        items={[
          { key: "skills", label: t("skills.tab.skills") },
          // key 保持 `templates`：它同时是路由 query 与状态机里的名字，改名要连带改
          // 跳转与测试；界面上的名字已改成「版式」（自制模板下线后只剩版式）。
          { key: "templates", label: t("skills.tab.layout") },
        ]}
      />

      {tab === "templates" ? (
        <TemplateWorkbench />
      ) : (
        <>
          <Card size="small" className="settings-card skills-intro-card">
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              技能是什么
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {t("skills.guide.whatBody")}
            </Typography.Paragraph>
            <Typography.Title level={5}>{t("skills.guide.howTitle")}</Typography.Title>
            <ol className="skills-intro-steps">
              <li>{t("skills.guide.how1")}</li>
              <li>{t("skills.guide.how2")}</li>
              <li>{t("skills.guide.how3")}</li>
            </ol>
            <Space wrap>
              <Typography.Text type="secondary">{t("skills.guide.templates")}</Typography.Text>
              {SKILL_TEMPLATES.map((template) => (
                <Tooltip key={template.label} title={template.hint}>
                  <Button size="small" onClick={() => openCreate(template.draft)}>
                    {template.label}
                  </Button>
                </Tooltip>
              ))}
            </Space>
          </Card>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title={t("skills.budget.title")}
          />

          {loading ? (
            <LoadingBlock />
          ) : error ? (
            <ErrorState
              description={t("skills.error.loadFailed", { error })}
              onRetry={() => void load()}
            />
          ) : skills.length === 0 ? (
            <Empty description={t("skills.empty")} />
          ) : (
            <Table
              rowKey="id"
              columns={columns}
              dataSource={skills}
              pagination={false}
              components={{
                body: {
                  // 整行右键：和「更多」菜单共用同一份菜单项，右键即可编辑。
                  row: (props: HTMLAttributes<HTMLTableRowElement>) => {
                    const rowKey = String(
                      (props as { "data-row-key"?: string })["data-row-key"] ?? "",
                    );
                    const skill = skills.find((item) => String(item.id) === rowKey);
                    return (
                      <RowContextMenu items={skill ? actionsFor(skill) : []}>
                        <tr {...props} />
                      </RowContextMenu>
                    );
                  },
                },
              }}
            />
          )}
        </>
      )}

      <SkillEditorModal
        open={editorOpen}
        skillId={editorSkillId}
        draft={editorDraft}
        onClose={() => setEditorOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}

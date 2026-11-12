// SPDX-License-Identifier: Apache-2.0
/**
 * 技能学习面板（#31D/E/F 前端接线）：检测 → 四段草稿确认 → 待验证；90 天归档提示。
 *
 * 三个产品约束写在这里而不是分散进页面：
 * 1. 生成**不自动生效**：接受草稿只创建 generated=True + validation_status=pending 的技能，
 *    不会挂到任何对话（启用仍是对话里勾选）；
 * 2. 证据不足不提议：detect 返回空 triggers 时只提示「没有可生成技能的模式」；
 * 3. 90 天未加载只**提示归档**，不自动删除——归档动作留给用户。
 */
import { Alert, App, Button, Card, Form, Input, Modal, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { listAssistantConversations } from "../../api/assistant";
import {
  acceptSkillDraft,
  detectSkillCandidate,
  listSkillArchiveCandidates,
  type SkillArchiveCandidate,
  type SkillLearningDraft,
} from "../../api/skill";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatDateTime } from "../../utils/format";

interface SkillLearningPanelProps {
  /** 接受草稿后通知页面重新拉技能列表。 */
  onChanged: () => void;
}

interface DraftFormValues {
  name: string;
  description: string;
  whenToUse: string;
  steps: string;
  pitfalls: string;
}

const TRIGGER_LABEL_KEYS: Record<string, MessageKey> = {
  repeat_workflow: "skills.learning.trigger.repeat_workflow",
  persistent_rule: "skills.learning.trigger.persistent_rule",
  long_success_trajectory: "skills.learning.trigger.long_success_trajectory",
};

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function SkillLearningPanel({ onChanged }: SkillLearningPanelProps) {
  useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<DraftFormValues>();
  const [archives, setArchives] = useState<SkillArchiveCandidate[]>([]);
  const [archiveDismissed, setArchiveDismissed] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [triggers, setTriggers] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    void listSkillArchiveCandidates()
      .then((items) => {
        if (mounted) setArchives(items);
      })
      .catch(() => {
        // 归档提示是增强项：读不到就不显示，不能因此挡住技能工作台。
      });
    return () => {
      mounted = false;
    };
  }, []);

  const detect = async () => {
    if (detecting) return;
    setDetecting(true);
    try {
      const conversations = await listAssistantConversations("page");
      const latest = conversations[0];
      if (!latest) {
        message.info(t("skills.learning.noConversation"));
        return;
      }
      const result = await detectSkillCandidate(latest.id);
      if (!result.draft || result.triggers.length === 0) {
        message.info(t("skills.learning.noSignal"));
        return;
      }
      setTriggers(result.triggers);
      form.setFieldsValue({
        name: result.draft.name,
        description: result.draft.description,
        whenToUse: result.draft.when_to_use,
        steps: result.draft.steps.join("\n"),
        pitfalls: result.draft.pitfalls.join("\n"),
      });
      setModalOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("skills.learning.detectFailed"));
    } finally {
      setDetecting(false);
    }
  };

  const submit = async () => {
    let values: DraftFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 表单自身已高亮缺项
    }
    const draft: SkillLearningDraft = {
      name: values.name.trim(),
      description: values.description.trim(),
      when_to_use: values.whenToUse.trim(),
      steps: splitLines(values.steps),
      pitfalls: splitLines(values.pitfalls),
    };
    setSubmitting(true);
    try {
      const accepted = await acceptSkillDraft(draft);
      message.success(t("skills.learning.accepted", { name: accepted.name }));
      setModalOpen(false);
      form.resetFields();
      onChanged();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("skills.learning.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const archiveAlert =
    archives.length > 0 && !archiveDismissed ? (
      <Alert
        data-testid="skill-learning-archive"
        type="warning"
        showIcon
        closable
        onClose={() => setArchiveDismissed(true)}
        style={{ marginBottom: 16 }}
        title={t("skills.learning.archive.title", { count: archives.length })}
        description={
          <div>
            <div>{t("skills.learning.archive.body")}</div>
            <ul style={{ margin: "4px 0 0", paddingInlineStart: 20 }}>
              {archives.map((item) => (
                <li key={item.skill_id}>
                  {t("skills.learning.archive.item", {
                    name: item.name,
                    time: item.last_loaded_at
                      ? formatDateTime(item.last_loaded_at)
                      : t("skills.learning.archive.neverLoaded"),
                  })}
                </li>
              ))}
            </ul>
          </div>
        }
      />
    ) : null;

  return (
    <>
      {archiveAlert}
      <Card size="small" className="settings-card" style={{ marginBottom: 16 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t("skills.learning.title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {t("skills.learning.intro")}
        </Typography.Paragraph>
        <Space wrap>
          <Button
            data-testid="skill-learning-detect"
            loading={detecting}
            onClick={() => void detect()}
          >
            {t("skills.learning.detect")}
          </Button>
          <Typography.Text type="secondary">{t("skills.learning.detectHint")}</Typography.Text>
        </Space>
      </Card>
      <Modal
        data-testid="skill-learning-modal"
        open={modalOpen}
        title={t("skills.learning.modal.title")}
        width={680}
        mask={{ closable: false }}
        okText={t("skills.learning.modal.ok")}
        cancelText={t("skills.learning.modal.cancel")}
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {t("skills.learning.modal.intro")}
        </Typography.Paragraph>
        {triggers.length > 0 && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={t("skills.learning.modal.triggers")}
            description={
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {triggers.map((trigger) => (
                  <li key={trigger}>
                    {t(TRIGGER_LABEL_KEYS[trigger] ?? "skills.learning.trigger.repeat_workflow")}
                  </li>
                ))}
              </ul>
            }
          />
        )}
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item
            name="name"
            label={t("skills.learning.form.name")}
            rules={[{ required: true, message: t("skills.learning.form.nameRequired") }]}
          >
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item
            name="description"
            label={t("skills.learning.form.description")}
            rules={[{ required: true, message: t("skills.learning.form.descriptionRequired") }]}
          >
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item
            name="whenToUse"
            label={t("skills.learning.form.whenToUse")}
            rules={[{ required: true, message: t("skills.learning.form.whenToUseRequired") }]}
          >
            <Input.TextArea rows={2} maxLength={255} />
          </Form.Item>
          <Form.Item
            name="steps"
            label={t("skills.learning.form.steps")}
            rules={[
              {
                validator: async (_rule, value: string) => {
                  if (splitLines(value || "").length === 0) {
                    throw new Error(t("skills.learning.form.stepsRequired"));
                  }
                },
              },
            ]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="pitfalls" label={t("skills.learning.form.pitfalls")}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

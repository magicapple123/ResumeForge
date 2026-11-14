// SPDX-License-Identifier: Apache-2.0
/**
 * 「存为知识条目」（#29B，F37 起从操作条的按钮改成右键菜单项 + 受控弹窗）。
 *
 * - 标题：回答首行（去空白）前 40 字，可在弹窗里改；
 * - 正文：整条回答的 Markdown 原文（与回答逐字一致，验证要求）；
 * - 分类：「面经 / 未分类」二选一，默认未分类（协议值来自 KNOWLEDGE_CATEGORIES，不手写中文枚举）；
 * - 来源：写「助手」字符串。后端 KnowledgeCreate（0014 前）没有 conversation/message id 列，
 *   所以消息 id 不落库——这一点写进证据，不假装它被保存了。
 *
 * 保存成功后气泡底部渲染一行「已存：<标题>」链接（结果，不是操作行），跳到知识库并带 q 搜索词。
 * 弹窗开关由调用方（气泡）握住，菜单项只负责调 `openModal`。
 */
import { App, Input, Modal, Select, Typography } from "antd";
import { useState, type ReactNode } from "react";
import type { AssistantMessage } from "../../../types";
import { KNOWLEDGE_CATEGORIES } from "../../../types";
import { createKnowledge } from "../../../api/knowledge";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

/** 标题预填长度：回答首行前 40 字（首行通常是结论，适合当标题）。 */
const TITLE_PREVIEW_CHARS = 40;
/** 面经分类的协议值（顺序与后端 KNOWLEDGE_CATEGORIES 一致，取第一项而不是手写中文）。 */
const INTERVIEW_NOTES_CATEGORY = KNOWLEDGE_CATEGORIES[0];

function titleFromContent(content: string): string {
  const firstLine =
    content
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  return firstLine.slice(0, TITLE_PREVIEW_CHARS);
}

export interface SaveKnowledgeState {
  /** 打开弹窗（右键菜单「存为知识」调用）。 */
  openModal: () => void;
  /** 弹窗本体；挂气泡末尾即可（关闭时 antd 不渲染内容）。 */
  modal: ReactNode;
  /** 保存成功后的「已存：标题」链接；未保存时为 null。 */
  savedLink: ReactNode;
}

export function useSaveKnowledge(message: AssistantMessage): SaveKnowledgeState {
  useLocale();
  const { message: toast } = App.useApp();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: number; title: string } | null>(null);

  const openModal = () => {
    setTitle(titleFromContent(message.content));
    setOpen(true);
  };

  const save = async () => {
    const nextTitle = title.trim();
    if (!nextTitle || saving) return;
    setSaving(true);
    try {
      const created = await createKnowledge({
        title: nextTitle,
        category,
        tags: [],
        content: message.content,
        source: t("assistantUi.saveKnowledge.source"),
      });
      setSaved({ id: created.id, title: created.title });
      setOpen(false);
      toast.success(t("assistantUi.saveKnowledge.toast", { title: created.title }));
    } catch (error) {
      // 失败给出路：错误原因 +「可重试 / 去知识库手动新建」都写在提示里，弹窗保持可重试。
      toast.error(
        t("assistantUi.saveKnowledge.failed", {
          error:
            error instanceof Error ? error.message : t("assistantUi.saveKnowledge.errorUnknown"),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = [
    { value: "", label: t("assistantUi.saveKnowledge.category.uncategorized") },
    {
      value: INTERVIEW_NOTES_CATEGORY,
      label: t("enumsKnowledge.category.knowledge.interviewNotes"),
    },
  ];

  const modal = (
    <Modal
      open={open}
      title={t("assistantUi.saveKnowledge.modalTitle")}
      okText={t("assistantUi.saveKnowledge.save")}
      cancelText={t("common.action.cancel")}
      confirmLoading={saving}
      okButtonProps={{ disabled: !title.trim() || undefined }}
      // 有写入请求：禁用蒙层关闭，避免误触把填了一半的表单关掉（点「取消」才关）。
      mask={{ closable: false }}
      onOk={() => void save()}
      onCancel={() => setOpen(false)}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {t("assistantUi.saveKnowledge.hint")}
      </Typography.Paragraph>
      <Typography.Text strong>{t("assistantUi.saveKnowledge.titleLabel")}</Typography.Text>
      <Input
        value={title}
        aria-label={t("assistantUi.saveKnowledge.titleLabel")}
        showCount
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        style={{ marginBottom: 12 }}
      />
      <Typography.Text strong>{t("assistantUi.saveKnowledge.categoryLabel")}</Typography.Text>
      <Select
        value={category}
        aria-label={t("assistantUi.saveKnowledge.categoryLabel")}
        options={categoryOptions}
        onChange={setCategory}
        style={{ width: "100%" }}
      />
    </Modal>
  );

  return {
    openModal,
    modal,
    savedLink: saved ? (
      // 组件也会被单独渲染在测试里（没有 Router 上下文），所以用 href 而不是 router Link；
      // 与 MessageToolCalls 的「前往查看」同一处理。
      <Typography.Link
        href={`/knowledge?q=${encodeURIComponent(saved.title)}`}
        className="assistant-save-knowledge-link"
      >
        {t("assistantUi.saveKnowledge.saved", { title: saved.title })}
      </Typography.Link>
    ) : null,
  };
}

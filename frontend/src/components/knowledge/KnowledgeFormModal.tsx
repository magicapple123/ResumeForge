// SPDX-License-Identifier: Apache-2.0
/** 知识库条目编辑：标题、分类、标签、来源与 Markdown 正文。 */

import { Form, Input, Select, Typography } from "antd";
import FormModal from "../common/FormModal";
import type { InputRef } from "antd";
import { useId, useRef, useState } from "react";
import { handleEditorSaveKey } from "../../utils/formKeyboard";
import type { Knowledge, KnowledgePayload } from "../../types";
import { KNOWLEDGE_CATEGORIES } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { knowledgeCategoryLabel } from "../../i18n/enum/knowledge";

interface Props {
  open: boolean;
  /** 传入条目表示编辑，传 null 表示新建。 */
  entry: Knowledge | null;
  categories: string[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: KnowledgePayload) => void;
}

export default function KnowledgeFormModal({
  open,
  entry,
  categories,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  useLocale();
  const fieldId = useId();
  const titleInput = useRef<InputRef>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("其他"); // i18n-ok: 分类兜底值是提交后端的协议值
  const [tags, setTags] = useState<string[]>([]);
  const [source, setSource] = useState("手动录入"); // i18n-ok: 来源兜底值是提交后端的协议值
  const [content, setContent] = useState("");

  // 打开时用条目内容（或空值）回填表单。Compiler 规范：随 prop 变化的重置用
  // 渲染期守卫式调整（key = open + entry 引用）。
  const [prevSync, setPrevSync] = useState<{ open: boolean; entry: Knowledge | null } | null>(null);
  if (prevSync === null || prevSync.open !== open || prevSync.entry !== entry) {
    setPrevSync({ open, entry });
    if (open) {
      setTitleTouched(false);
      setTitle(entry?.title ?? "");
      setCategory(entry?.category || "其他"); // i18n-ok: 分类兜底值是提交后端的协议值
      setTags(entry?.tags ?? []);
      setSource(entry?.source || "手动录入"); // i18n-ok: 来源兜底值是提交后端的协议值
      setContent(entry?.content ?? "");
    }
  }

  const options = Array.from(new Set([...categories, ...KNOWLEDGE_CATEGORIES]));

  const submit = () => {
    if (submitting) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleTouched(true);
      titleInput.current?.focus();
      return;
    }
    onSubmit({
      title: trimmedTitle,
      category: category.trim() || "其他", // i18n-ok: 分类兜底值是提交后端的协议值
      tags: tags.map((tag) => tag.trim()).filter(Boolean),
      source: source.trim() || "手动录入", // i18n-ok: 来源兜底值是提交后端的协议值
      content,
    });
  };

  return (
    <FormModal
      title={entry ? t("knowledgeForm.title.edit") : t("knowledgeForm.title.create")}
      open={open}
      width={720}
      onCancel={onCancel}
      submitting={submitting}
      onSubmit={submit}
      okText={t("knowledgeForm.action.save")}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("knowledgeForm.intro")}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {t("knowledgeForm.hint.shortcut")}
      </Typography.Paragraph>
      <Form
        layout="vertical"
        disabled={submitting}
        onKeyDown={(event) => handleEditorSaveKey(event, submit)}
      >
        <Form.Item
          label={t("knowledgeForm.label.title")}
          htmlFor={`${fieldId}-title`}
          required
          validateStatus={titleTouched && !title.trim() ? "error" : undefined}
          help={
            titleTouched && !title.trim() ? (
              <span id={`${fieldId}-title-error`}>{t("knowledgeForm.error.titleRequired")}</span>
            ) : undefined
          }
        >
          <Input
            ref={titleInput}
            id={`${fieldId}-title`}
            aria-invalid={titleTouched && !title.trim()}
            aria-describedby={titleTouched && !title.trim() ? `${fieldId}-title-error` : undefined}
            onBlur={() => setTitleTouched(true)}
            showCount
            value={title}
            maxLength={200}
            placeholder={t("knowledgeForm.placeholder.title")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Form.Item>
        <Form.Item label={t("knowledgeForm.label.category")} htmlFor={`${fieldId}-category`}>
          <Select
            id={`${fieldId}-category`}
            // tags 模式的取值是数组，这里始终只放一项，对外仍当单个字符串用。
            value={category ? [category] : []}
            showSearch
            options={options.map((item) => ({ value: item, label: knowledgeCategoryLabel(item) }))}
            // 允许输入新分类：固定的那几个只能算起点。
            // 不加 maxCount={1}：antd 在已选数达到 maxCount 时会把下拉里所有
            // 未选中项置灰禁用，导致编辑时改选不了其他分类；onChange 只取
            // 最后一位，多选的一瞬间也会收敛回单个分类。
            mode="tags"
            // i18n-ok: 分类兜底值是提交后端的协议值
            onChange={(values: string[]) => setCategory(values[values.length - 1] ?? "其他")}
            placeholder={t("knowledgeForm.placeholder.category")}
          />
        </Form.Item>
        <Form.Item label={t("knowledgeForm.label.tags")} htmlFor={`${fieldId}-tags`}>
          <Select
            id={`${fieldId}-tags`}
            mode="tags"
            value={tags}
            maxCount={20}
            placeholder={t("knowledgeForm.placeholder.tags")}
            onChange={setTags}
            tokenSeparators={[",", "，"]}
          />
        </Form.Item>
        <Form.Item label={t("knowledgeForm.label.source")} htmlFor={`${fieldId}-source`}>
          <Input
            id={`${fieldId}-source`}
            value={source}
            maxLength={64}
            placeholder={t("knowledgeForm.placeholder.source")}
            onChange={(event) => setSource(event.target.value)}
          />
        </Form.Item>
        <Form.Item
          label={t("knowledgeForm.label.content")}
          htmlFor={`${fieldId}-content`}
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            id={`${fieldId}-content`}
            value={content}
            autoSize={{ minRows: 8, maxRows: 20 }}
            placeholder={t("knowledgeForm.placeholder.content")}
            onChange={(event) => setContent(event.target.value)}
          />
        </Form.Item>
      </Form>
    </FormModal>
  );
}

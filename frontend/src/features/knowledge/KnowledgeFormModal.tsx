// SPDX-License-Identifier: Apache-2.0
/**
 * 知识库条目编辑（#29C/#29D/#29E）：标题下一行 reason（为什么记这条）、关联公司/岗位、
 * 分类（可选，留空 = 未分类）、摘要 + 要点、标签、来源与 Markdown 正文。
 *
 * 分类是**建议不是约束**（#29G）：不选就是未分类，不再兜成「其他」——把"用户没选"
 * 伪装成"用户选了其他"会让「未分类」筛选永远为空。
 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Select, Space, Typography } from "antd";
import FormModal from "../../components/common/FormModal";
import type { InputRef } from "antd";
import { useEffect, useId, useRef, useState } from "react";
import { handleEditorSaveKey } from "../../utils/formKeyboard";
import { listJobs } from "../../api/jobs";
import type { JobList, Knowledge, KnowledgePayload } from "../../types";
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

/** 要点输入上限：与后端 MAX_KNOWLEDGE_KEY_POINTS / MAX_KNOWLEDGE_KEY_POINT_CHARS 一致。 */
const MAX_KEY_POINTS = 20;
const MAX_KEY_POINT_CHARS = 200;

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
  const jobRequestSeq = useRef(0);
  const [titleTouched, setTitleTouched] = useState(false);
  const [title, setTitle] = useState("");
  // #29G：空串 = 未分类（合法状态）。
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [source, setSource] = useState("手动录入"); // i18n-ok: 来源兜底值是提交后端的协议值
  const [content, setContent] = useState("");
  const [reason, setReason] = useState("");
  const [company, setCompany] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [jobOptions, setJobOptions] = useState<JobList[]>([]);
  const [jobLoading, setJobLoading] = useState(false);

  // 打开时用条目内容（或空值）回填表单。Compiler 规范：随 prop 变化的重置用
  // 渲染期守卫式调整（key = open + entry 引用）。
  const [prevSync, setPrevSync] = useState<{ open: boolean; entry: Knowledge | null } | null>(null);
  if (prevSync === null || prevSync.open !== open || prevSync.entry !== entry) {
    setPrevSync({ open, entry });
    if (open) {
      setTitleTouched(false);
      setTitle(entry?.title ?? "");
      setCategory(entry?.category ?? "");
      setTags(entry?.tags ?? []);
      setSource(entry?.source || "手动录入"); // i18n-ok: 来源兜底值是提交后端的协议值
      setContent(entry?.content ?? "");
      setReason(entry?.reason ?? "");
      setCompany(entry?.company ?? "");
      setJobId(entry?.job_id ?? null);
      setSummary(entry?.summary ?? "");
      setKeyPoints(entry?.key_points ?? []);
    }
  }

  // 关联岗位选择器：打开时先取最近 20 条，输入时按关键词远程搜索（失败静默，
  // 岗位关联是可选字段，不该因为它挡住保存）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listJobs({ page_size: 20 })
      .then((page) => {
        if (cancelled) return;
        setJobOptions((previous) => {
          const merged = [...page.items];
          for (const item of previous) {
            if (!merged.some((candidate) => candidate.id === item.id)) merged.push(item);
          }
          return merged;
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setJobLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const searchJobs = (keyword: string) => {
    const seq = jobRequestSeq.current + 1;
    jobRequestSeq.current = seq;
    setJobLoading(true);
    listJobs({ keyword: keyword.trim(), page_size: 20 })
      .then((page) => {
        if (jobRequestSeq.current === seq) setJobOptions(page.items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (jobRequestSeq.current === seq) setJobLoading(false);
      });
  };

  const options = Array.from(new Set([...categories, ...KNOWLEDGE_CATEGORIES]));
  const jobSelectOptions = [
    ...jobOptions.map((job) => ({
      value: job.id,
      label: job.company ? `${job.title} · ${job.company}` : job.title,
    })),
    ...(jobId !== null && !jobOptions.some((job) => job.id === jobId)
      ? [{ value: jobId, label: `#${jobId}` }]
      : []),
  ];

  const submit = () => {
    if (submitting) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleTouched(true);
      titleInput.current?.focus();
      return;
    }
    const cleanedPoints = Array.from(
      new Set(keyPoints.map((point) => point.trim()).filter(Boolean)),
    ).slice(0, MAX_KEY_POINTS);
    onSubmit({
      title: trimmedTitle,
      // #29G：空分类 = 未分类，不再兜底成「其他」。
      category: category.trim(),
      tags: tags.map((tag) => tag.trim()).filter(Boolean),
      // i18n-ok: 来源兜底值是提交后端的协议值
      source: source.trim() || "手动录入",
      content,
      reason: reason.trim(),
      company: company.trim(),
      job_id: jobId,
      summary: summary.trim(),
      key_points: cleanedPoints,
    });
  };

  return (
    <FormModal
      title={entry ? t("knowledgeForm.title.edit") : t("knowledgeForm.title.create")}
      open={open}
      width={760}
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
        <Form.Item
          label={t("knowledgeForm.label.reason")}
          htmlFor={`${fieldId}-reason`}
          extra={t("knowledgeForm.hint.reason")}
        >
          <Input
            id={`${fieldId}-reason`}
            value={reason}
            maxLength={120}
            showCount
            placeholder={t("knowledgeForm.placeholder.reason")}
            onChange={(event) => setReason(event.target.value)}
          />
        </Form.Item>
        <Form.Item label={t("knowledgeForm.label.category")} htmlFor={`${fieldId}-category`}>
          <Select
            id={`${fieldId}-category`}
            // tags 模式的取值是数组，这里始终只放一项，对外仍当单个字符串用。
            value={category ? [category] : []}
            showSearch
            allowClear
            options={options.map((item) => ({ value: item, label: knowledgeCategoryLabel(item) }))}
            // 保留 tags 模式：允许输入新分类（固定的那几个只能算起点）；清空即未分类。
            mode="tags"
            onChange={(values: string[]) => setCategory(values[values.length - 1] ?? "")}
            placeholder={t("knowledgeForm.placeholder.category")}
          />
        </Form.Item>
        <Space size={12} wrap style={{ display: "flex" }}>
          <Form.Item
            label={t("knowledgeForm.label.company")}
            htmlFor={`${fieldId}-company`}
            style={{ minWidth: 240 }}
          >
            <Input
              id={`${fieldId}-company`}
              value={company}
              maxLength={128}
              placeholder={t("knowledgeForm.placeholder.company")}
              onChange={(event) => setCompany(event.target.value)}
            />
          </Form.Item>
          <Form.Item
            label={t("knowledgeForm.label.job")}
            htmlFor={`${fieldId}-job`}
            style={{ minWidth: 280 }}
          >
            <Select
              id={`${fieldId}-job`}
              value={jobId ?? undefined}
              allowClear
              showSearch
              filterOption={false}
              loading={jobLoading}
              options={jobSelectOptions}
              placeholder={t("knowledgeForm.placeholder.job")}
              style={{ width: 280 }}
              onSearch={searchJobs}
              onChange={(value: number | undefined) => setJobId(value ?? null)}
            />
          </Form.Item>
        </Space>
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
        <Form.Item label={t("knowledgeForm.label.summary")} htmlFor={`${fieldId}-summary`}>
          <Input.TextArea
            id={`${fieldId}-summary`}
            value={summary}
            maxLength={300}
            showCount
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder={t("knowledgeForm.placeholder.summary")}
            onChange={(event) => setSummary(event.target.value)}
          />
        </Form.Item>
        <Form.Item
          label={t("knowledgeForm.label.keyPoints")}
          extra={t("knowledgeForm.hint.keyPoints")}
          style={{ marginBottom: 8 }}
        >
          <Space direction="vertical" style={{ width: "100%" }} size={6}>
            {keyPoints.map((point, index) => (
              <Space key={index} style={{ width: "100%" }}>
                <Input
                  aria-label={`${t("knowledgeForm.label.keyPoints")} ${index + 1}`}
                  value={point}
                  maxLength={MAX_KEY_POINT_CHARS}
                  placeholder={t("knowledgeForm.placeholder.keyPoint")}
                  onChange={(event) =>
                    setKeyPoints((previous) =>
                      previous.map((item, position) =>
                        position === index ? event.target.value : item,
                      ),
                    )
                  }
                />
                <Button
                  type="text"
                  danger
                  aria-label={t("knowledgeForm.action.removeKeyPoint")}
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setKeyPoints((previous) =>
                      previous.filter((_item, position) => position !== index),
                    )
                  }
                />
              </Space>
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              disabled={keyPoints.length >= MAX_KEY_POINTS}
              onClick={() => setKeyPoints((previous) => [...previous, ""])}
            >
              {t("knowledgeForm.action.addKeyPoint")}
            </Button>
          </Space>
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

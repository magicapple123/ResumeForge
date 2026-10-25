// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产编辑弹窗（W17 / D16）：正文 / 类型 / 语言 / 岗位标签 / 备注。
 *
 * 「更新先看差异」：正文有改动时先在弹窗内展示词级 diff（修改前 → 修改后），
 * 用户点「确认保存」才提交 PATCH；只改标签/类型等非正文字段时直接保存。
 * 已插入简历的副本永不回写（契约 §3.3 不自动同步）。
 */
import { Alert, Button, Input, Modal, Select, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import { at } from "../../../features/resume-assets/i18n";
import {
  MAX_PHRASE_TAG_LENGTH,
  MAX_PHRASE_TAGS,
  normalizePhraseTags,
} from "../../../features/resume-assets/phraseTags";
import {
  PHRASE_KINDS,
  type PhraseKind,
  type PhraseUpdatePayload,
  type ResumePhrase,
} from "../../../features/resume-assets/types";
import PhraseDiffPreview from "./PhraseDiffPreview";

interface Props {
  open: boolean;
  phrase: ResumePhrase;
  saving?: boolean;
  onCancel: () => void;
  onSave: (payload: PhraseUpdatePayload) => void;
}

const KIND_LABEL_KEYS: Record<PhraseKind, Parameters<typeof at>[0]> = {
  achievement: "assets.kind.achievement",
  method: "assets.kind.method",
  result: "assets.kind.result",
  summary: "assets.kind.summary",
  custom: "assets.kind.custom",
};

// i18n-ok: 全角逗号/顿号是标签输入分隔符（输入法常用），不是界面文案
const TAG_SEPARATORS = [",", "，", "、"];

const LANGUAGE_OPTIONS = [
  { value: "", label: at("assets.language.unknown") },
  { value: "zh-CN", label: at("assets.language.zh-CN") },
  { value: "en-US", label: at("assets.language.en-US") },
];

export default function PhraseEditorModal({
  open,
  phrase,
  saving = false,
  onCancel,
  onSave,
}: Props) {
  const [phase, setPhase] = useState<"edit" | "diff">("edit");
  const [text, setText] = useState(phrase.text);
  const [kind, setKind] = useState<PhraseKind>(phrase.kind);
  const [language, setLanguage] = useState(phrase.language);
  const [tags, setTags] = useState<string[]>(phrase.job_tags);
  const [note, setNote] = useState(phrase.quality_note ?? "");

  const normalizedTags = useMemo(() => normalizePhraseTags(tags), [tags]);
  const textChanged = text.trim() !== phrase.text.trim();
  const payload: PhraseUpdatePayload = {
    text: text.trim(),
    kind,
    language,
    job_tags: normalizedTags.tags,
    quality_note: note.trim(),
  };

  const requestSubmit = () => {
    if (!text.trim()) return;
    if (textChanged) {
      setPhase("diff");
      return;
    }
    onSave(payload);
  };

  const footer =
    phase === "diff"
      ? [
          <Button key="back" onClick={() => setPhase("edit")} disabled={saving || undefined}>
            {at("assets.editor.back")}
          </Button>,
          <Button
            key="confirm"
            type="primary"
            loading={saving || undefined}
            onClick={() => onSave(payload)}
          >
            {at("assets.editor.confirm")}
          </Button>,
        ]
      : [
          <Button key="cancel" onClick={onCancel} disabled={saving || undefined}>
            {at("assets.editor.cancel")}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={saving || undefined}
            disabled={!text.trim() || undefined}
            onClick={requestSubmit}
          >
            {at("assets.editor.save")}
          </Button>,
        ];

  return (
    <Modal
      open={open}
      title={phase === "diff" ? at("assets.editor.diffTitle") : at("assets.editor.title")}
      onCancel={onCancel}
      mask={{ closable: false }}
      destroyOnHidden
      width={640}
      footer={footer}
    >
      {phase === "diff" ? (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Alert type="info" showIcon title={at("assets.editor.diffHint")} />
          <PhraseDiffPreview before={phrase.text} after={text.trim()} />
        </Space>
      ) : (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <label>
            <Typography.Text style={{ fontSize: 12 }}>{at("assets.editor.text")}</Typography.Text>
            <Input.TextArea
              rows={4}
              maxLength={2000}
              value={text}
              aria-label={at("assets.editor.text")}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <Space size={8} wrap>
            <label>
              <Typography.Text style={{ fontSize: 12 }}>{at("assets.editor.kind")}</Typography.Text>
              <Select
                size="small"
                value={kind}
                aria-label={at("assets.editor.kind")}
                options={PHRASE_KINDS.map((item) => ({
                  value: item,
                  label: at(KIND_LABEL_KEYS[item]),
                }))}
                onChange={(value) => setKind(value)}
              />
            </label>
            <label>
              <Typography.Text style={{ fontSize: 12 }}>
                {at("assets.editor.language")}
              </Typography.Text>
              <Select
                size="small"
                value={language}
                aria-label={at("assets.editor.language")}
                options={LANGUAGE_OPTIONS}
                onChange={(value) => setLanguage(value)}
              />
            </label>
          </Space>
          <label>
            <Typography.Text style={{ fontSize: 12 }}>{at("assets.editor.tags")}</Typography.Text>
            <Select
              mode="tags"
              value={normalizedTags.tags}
              aria-label={at("assets.editor.tags")}
              placeholder={at("assets.editor.tagsPlaceholder")}
              tokenSeparators={TAG_SEPARATORS}
              onChange={(values) => setTags(values.map(String))}
              style={{ width: "100%" }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {at("assets.editor.tagsHint", {
                count: MAX_PHRASE_TAGS,
                length: MAX_PHRASE_TAG_LENGTH,
              })}
            </Typography.Text>
          </label>
          {normalizedTags.truncated ? (
            <Alert
              type="warning"
              showIcon
              title={at("assets.editor.tagsTooMany", { count: MAX_PHRASE_TAGS })}
            />
          ) : null}
          {normalizedTags.ignored > 0 ? (
            <Alert
              type="warning"
              showIcon
              title={at("assets.editor.tagTooLong", { length: MAX_PHRASE_TAG_LENGTH })}
            />
          ) : null}
          <label>
            <Typography.Text style={{ fontSize: 12 }}>{at("assets.editor.note")}</Typography.Text>
            <Input
              maxLength={256}
              value={note}
              aria-label={at("assets.editor.note")}
              placeholder={at("assets.editor.notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </Space>
      )}
    </Modal>
  );
}

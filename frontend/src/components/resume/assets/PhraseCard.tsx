// SPDX-License-Identifier: Apache-2.0
/**
 * 一条表达资产（W17 / D16）的卡片：正文 + 类型/语言/来源徽标 + 岗位标签 + 三个动作。
 *
 * ## 边界
 *
 * 组件**不**执行副作用：插入/删除/复制都只是回调，由宿主决定插到哪、怎么确认、要不要 Toast。
 * 这样同一个卡片能同时服务制作台（插入当前简历）、资产库页（只管理）与生成流程（只读）。
 *
 * ## 为什么正文要剥掉 `**`
 *
 * 资产库列表是**预览**，不是渲染：用户要判断"这句表达值不值得用"，标记符号只会干扰阅读。
 * 剥标记复用预览链路已有的 `stripMarkers`（与后端 `resume_rich_text` 同口径），不写第二份解析。
 *
 * 2026-10-25（任务 C2）：排版从内联样式搬进 `assets.css`（正文 13px/1.6、标签行与动作行
 * 间距 8px、动作右对齐）。回调、aria-label 与文案 key 一律不动。
 */
import { CopyOutlined, DeleteOutlined, DownloadOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Tag, Tooltip } from "antd";
import { stripMarkers } from "../../resume-preview/richText";
import { at } from "../../../features/resume-assets/i18n";
import { phraseSourceKind, type ResumePhrase } from "../../../features/resume-assets/types";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  phrase: ResumePhrase;
  /** 1-based，仅用于 aria-label（"把资产第 N 条插入到简历"）。 */
  index: number;
  /** 当前有没有可插入的简历（没有时按钮禁用并说明原因）。 */
  insertEnabled: boolean;
  onInsert?: (phrase: ResumePhrase) => void;
  onRequestDelete?: (phrase: ResumePhrase) => void;
  onCopy?: (phrase: ResumePhrase) => void;
  /** 打开编辑弹窗（正文/类型/语言/岗位标签）；不传 = 不渲染入口。 */
  onEdit?: (phrase: ResumePhrase) => void;
}

function kindLabel(phrase: ResumePhrase): string {
  return at(("assets.kind." + phrase.kind) as Parameters<typeof at>[0]);
}

function languageLabel(phrase: ResumePhrase): string {
  if (!phrase.language) return at("assets.language.unknown");
  if (phrase.language === "zh-CN") return at("assets.language.zh-CN");
  if (phrase.language === "en-US") return at("assets.language.en-US");
  return phrase.language;
}

function sourceLabel(phrase: ResumePhrase): string {
  const kind = phraseSourceKind(phrase);
  if (kind === "claim") return at("assets.source.claim");
  if (kind === "resume") return at("assets.source.resume");
  return at("assets.source.manual");
}

function usageLabel(phrase: ResumePhrase): string {
  return phrase.usage_count > 0
    ? at("assets.usage", { count: phrase.usage_count })
    : at("assets.usage.never");
}

export default function PhraseCard({
  phrase,
  index,
  insertEnabled,
  onInsert,
  onRequestDelete,
  onCopy,
  onEdit,
}: Props) {
  useLocale();
  const plainText = stripMarkers(phrase.text);
  return (
    <div data-phrase-id={phrase.id} className="resume-phrase-card">
      <p className="resume-phrase-card-text">{plainText}</p>
      <div className="resume-phrase-card-tags">
        <Tag>{kindLabel(phrase)}</Tag>
        <Tag>{languageLabel(phrase)}</Tag>
        <Tag color="blue">{sourceLabel(phrase)}</Tag>
        {phrase.job_tags.map((tag) => (
          <Tag key={tag} color="geekblue">
            {tag}
          </Tag>
        ))}
        <span className="resume-phrase-card-usage">{usageLabel(phrase)}</span>
      </div>
      <div className="resume-phrase-card-actions">
        <Tooltip title={insertEnabled ? undefined : at("assets.action.insertUnavailable")}>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<DownloadOutlined />}
            disabled={!insertEnabled || !onInsert || undefined}
            aria-label={at("assets.action.insertAria", { index })}
            onClick={() => onInsert?.(phrase)}
          >
            {at("assets.action.insert")}
          </Button>
        </Tooltip>
        {onCopy ? (
          <Tooltip title={at("assets.action.copy")}>
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              aria-label={at("assets.action.copyAria", { index })}
              onClick={() => onCopy(phrase)}
            />
          </Tooltip>
        ) : null}
        {onEdit ? (
          <Tooltip title={at("assets.action.edit")}>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              aria-label={at("assets.action.editAria", { index })}
              onClick={() => onEdit(phrase)}
            />
          </Tooltip>
        ) : null}
        {onRequestDelete ? (
          <Tooltip title={at("assets.action.delete")}>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label={at("assets.action.delete")}
              onClick={() => onRequestDelete(phrase)}
            />
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

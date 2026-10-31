// SPDX-License-Identifier: Apache-2.0
/**
 * 翻译候选面板（W16 / D15，v2 文档模型）：逐条看差异、勾选采纳、被事实锁拦下的不可勾选。
 *
 * 差异渲染复用版本对比的 `DiffTokenText`（同一套三态配色），不重算 diff、不另写高亮。
 * **取消/失败不改正文**：本组件只发回调，采纳由宿主持有路径与译文后统一写库。
 *
 * v2 口径：候选的 `path` 是 `ResumeDocument` 的 item 路径（`header.{itemId}` /
 * `{section}.{entry}.{item}`），采纳接口原样接收；`label` 已由上层按字段目录解析成显示名，
 * 组件不再自己查文案 key。
 */
import { Alert, Button, Checkbox, Space, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { DiffTokenText } from "../../ResumeDiffView";
import ErrorState from "../../common/ErrorState";
import LoadingBlock from "../../common/LoadingBlock";
import { bt } from "../../../features/resume-bilingual/i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { TranslationCandidate } from "../../../features/resume-bilingual/types";

interface Props {
  candidates: TranslationCandidate[];
  loading?: boolean;
  error?: string | null;
  /** 正在提交采纳（按钮转圈并禁用）。 */
  adopting?: boolean;
  onAdopt: (paths: string[]) => void;
  onCancel?: () => void;
  onRetry?: () => void;
}

export default function TranslationCandidatePanel({
  candidates,
  loading = false,
  error = null,
  adopting = false,
  onAdopt,
  onCancel,
  onRetry,
}: Props) {
  useLocale();
  const [selected, setSelected] = useState<string[]>([]);

  if (error) {
    return (
      <ErrorState
        description={error}
        onRetry={onRetry}
        retryLabel={bt("bilingual.candidate.retry")}
      />
    );
  }
  if (loading) {
    return <LoadingBlock tip={bt("bilingual.candidate.loading")} />;
  }
  if (candidates.length === 0) {
    return <EmptyHint />;
  }

  const selectable = candidates.filter((item) => !item.blocked);
  const allChecked = selectable.length > 0 && selected.length === selectable.length;

  const toggle = (path: string) => {
    setSelected((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  };

  return (
    <div className="translation-candidates" data-translation-candidates="1">
      <Space size={8} wrap className="translation-candidates__bulk">
        <Checkbox
          checked={allChecked}
          indeterminate={selected.length > 0 && !allChecked}
          disabled={selectable.length === 0 || undefined}
          onChange={(event) =>
            setSelected(event.target.checked ? selectable.map((item) => item.path) : [])
          }
        >
          {bt("bilingual.candidate.hint")}
        </Checkbox>
      </Space>
      <Space orientation="vertical" size={8} className="translation-candidates__list">
        {candidates.map((candidate, index) => (
          <div
            key={candidate.path}
            className="translation-candidate"
            data-candidate-path={candidate.path}
          >
            <Space size={8} wrap align="center" className="translation-candidate__head">
              <Checkbox
                checked={selected.includes(candidate.path)}
                disabled={candidate.blocked || undefined}
                aria-label={bt("bilingual.compare.adoptAria", { index: index + 1 })}
                onChange={() => toggle(candidate.path)}
              />
              <Typography.Text strong>{candidate.label}</Typography.Text>
              {candidate.blocked ? (
                <Tooltip title={bt("bilingual.candidate.blocked")}>
                  <Tag color="gold">{bt("bilingual.compare.locked")}</Tag>
                </Tooltip>
              ) : null}
            </Space>
            <div className="translation-candidate__text">
              <DiffTokenText tokens={candidate.tokens} />
            </div>
          </div>
        ))}
      </Space>
      <Space size={8} className="translation-candidates__actions" wrap>
        <Tooltip title={selected.length === 0 ? bt("bilingual.candidate.adoptNone") : undefined}>
          <Button
            type="primary"
            loading={adopting}
            disabled={selected.length === 0 || undefined}
            onClick={() => onAdopt(selected)}
          >
            {bt("bilingual.candidate.adoptSelected", { count: selected.length })}
          </Button>
        </Tooltip>
        {onCancel ? (
          <Button onClick={onCancel} disabled={adopting || undefined}>
            {bt("bilingual.candidate.cancel")}
          </Button>
        ) : null}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {bt("bilingual.candidate.note")}
        </Typography.Text>
      </Space>
    </div>
  );
}

function EmptyHint() {
  useLocale();
  return <Alert type="info" showIcon title={bt("bilingual.candidate.empty")} />;
}

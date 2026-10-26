// SPDX-License-Identifier: Apache-2.0
/**
 * 翻译候选面板（W16 / D15）：逐条看差异、勾选采纳、被事实锁拦下的不可勾选。
 *
 * 差异渲染复用版本对比的 `DiffTokenText`（同一套三态配色），不重算 diff、不另写高亮。
 * **取消/失败不改正文**：本组件只发回调，采纳由宿主在校验通过后统一写库。
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
    <div data-translation-candidates="1">
      <Space size={8} wrap style={{ marginBottom: 8 }}>
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
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        {candidates.map((candidate, index) => (
          <div
            key={candidate.path}
            data-candidate-path={candidate.path}
            style={{
              border: "1px solid var(--rf-border-subtle)",
              borderRadius: 8,
              padding: "8px 10px",
              background: "var(--rf-surface-alt)",
            }}
          >
            <Space size={8} wrap align="center" style={{ marginBottom: 4 }}>
              <Checkbox
                checked={selected.includes(candidate.path)}
                disabled={candidate.blocked || undefined}
                aria-label={bt("bilingual.compare.adoptAria", { index: index + 1 })}
                onChange={() => toggle(candidate.path)}
              />
              <Typography.Text strong>
                {bt(candidate.labelKey as Parameters<typeof bt>[0])}
              </Typography.Text>
              {candidate.blocked ? (
                <Tooltip title={bt("bilingual.candidate.blocked")}>
                  <Tag color="gold">{bt("bilingual.compare.locked")}</Tag>
                </Tooltip>
              ) : null}
            </Space>
            <div style={{ fontSize: 13, wordBreak: "break-word" }}>
              <DiffTokenText tokens={candidate.tokens} />
            </div>
          </div>
        ))}
      </Space>
      <Space size={8} style={{ marginTop: 8 }} wrap>
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

// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位匹配用的「选哪份简历」下拉：0 = 跟随默认（岗位关联的那份，或最近一份）。
 *
 * `include_general` 只在有岗位时传：有岗位时要能选通用简历；没有岗位时列表本身就是通用
 * 池，再传会把同一批查两遍。加载失败不静默退化成「用默认」，而是给一条可重试的警告——
 * 匹配前选不到简历是明确的错误。
 */
import { Alert, Button, Select, Space, Typography } from "antd";
import { useId } from "react";
import { listResumes } from "../../api/resumes";
import { useApi } from "../../hooks/useApi";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  jobId?: number;
  value?: number;
  onChange: (value: number | undefined) => void;
  disabled?: boolean;
}

export default function JobMatchResumeSelect({ jobId, value, onChange, disabled }: Props) {
  useLocale();
  const labelId = useId();
  const { data, loading, error, reload } = useApi(
    () => listResumes({ job_id: jobId, include_general: jobId ? true : undefined, page_size: 100 }),
    [jobId],
  );
  return (
    <Space orientation="vertical" size={4} style={{ width: "100%", marginBottom: 12 }}>
      <Typography.Text id={labelId}>{t("jobMatch.resume.label")}</Typography.Text>
      <Select
        aria-labelledby={labelId}
        value={value ?? 0}
        onChange={(id) => onChange(id || undefined)}
        disabled={disabled || undefined}
        loading={loading}
        showSearch={{ optionFilterProp: "label" }}
        style={{ width: "100%" }}
        options={[
          { value: 0, label: t("jobMatch.resume.default") },
          ...(data?.items ?? []).map((resume) => ({ value: resume.id, label: resume.title })),
        ]}
      />
      {error && (
        <Alert
          type="warning"
          title={t("jobMatch.resume.loadError")}
          action={
            <Button size="small" onClick={() => void reload()}>
              {t("jobMatch.resume.retry")}
            </Button>
          }
        />
      )}
    </Space>
  );
}

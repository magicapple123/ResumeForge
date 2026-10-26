// SPDX-License-Identifier: Apache-2.0
/**
 * 导入回传批注（W18 / 契约 §4.4、§4.5）。
 *
 * 两步校验：前端先按 `annotations.json` v1 解析（格式/版本/长度/锚点/编号重复），把能
 * 看出来的问题一次列全，用户不必为同一个坏文件反复发请求；通过后再交给服务端做
 * fail-closed 九步校验（权限、token、快照、版本归属、去重、事务）。
 *
 * 只接受 JSON：Markdown 没有对象锚点，硬解析成对象只能靠猜（plan §D17 禁止）。
 */
import { UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Space, Upload } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { parseReviewPack, REVIEW_PACK_MAX_BYTES } from "../../../features/resume-review";
import type { ReviewPackIssue } from "../../../features/resume-review";
import { reviewIssueText } from "./reviewImportIssue";
import { useLocale } from "../../../i18n/i18nContext";

export interface ReviewImportFormProps {
  /** 原始 JSON 文本（受控，便于测试与"粘贴/选文件"共用一条路径）。 */
  content: string;
  onContentChange: (next: string) => void;
  /** 通过前端解析后提交给服务端；抛错由调用方展示。 */
  onSubmit: (content: string) => Promise<void>;
  submitting: boolean;
  onCancel: () => void;
}

export default function ReviewImportForm({
  content,
  onContentChange,
  onSubmit,
  submitting,
  onCancel,
}: ReviewImportFormProps) {
  useLocale();
  const [issues, setIssues] = useState<ReviewPackIssue[] | null>(null);
  const [error, setError] = useState("");

  const readFile = async (file: File) => {
    if (file.size > REVIEW_PACK_MAX_BYTES) {
      setIssues([]);
      setError(t("review.import.fileTooLarge"));
      return;
    }
    try {
      onContentChange(await file.text());
      setError("");
      setIssues(null);
    } catch {
      setError(t("review.import.readFailed"));
    }
  };

  const submit = async () => {
    if (!content.trim()) {
      setError(t("review.import.empty"));
      return;
    }
    const parsed = parseReviewPack(content);
    if (!parsed.ok) {
      setIssues(parsed.issues);
      setError("");
      return;
    }
    setIssues(null);
    setError("");
    try {
      await onSubmit(content);
    } catch (cause) {
      // 服务端错误文案（403/422 的 detail）直接展示：它比前端兜底更具体。
      const detail =
        cause instanceof Error && cause.message ? cause.message : t("review.import.failed");
      setError(detail);
    }
  };

  return (
    <div className="resume-review-import">
      <p className="resume-review-hint">{t("review.import.hint")}</p>
      <Space wrap>
        <Upload
          accept=".json,application/json"
          showUploadList={false}
          beforeUpload={(file) => {
            void readFile(file);
            // 只在前端读文本，不把回传文件上传到任何地方（隐私边界）。
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>{t("review.import.file")}</Button>
        </Upload>
        <span className="resume-review-hint">{t("review.import.formatHint")}</span>
      </Space>
      <Input.TextArea
        aria-label={t("review.import.pasteLabel")}
        rows={6}
        value={content}
        placeholder={t("review.import.placeholder")}
        onChange={(event) => {
          onContentChange(event.target.value);
          setIssues(null);
          setError("");
        }}
      />
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {issues && issues.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={t("review.import.failed")}
          description={
            <ul className="resume-review-issues">
              {issues.map((issue, index) => (
                <li key={index}>{reviewIssueText(issue)}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      <Space>
        <Button type="primary" loading={submitting} onClick={() => void submit()}>
          {t("review.import.submit")}
        </Button>
        <Button onClick={onCancel}>{t("review.import.cancel")}</Button>
      </Space>
      <p className="resume-review-hint">{t("review.import.dedupHint")}</p>
    </div>
  );
}

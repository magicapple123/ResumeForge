// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位 CSV 导入（**抽屉内的一个视图**，不是弹窗）：上传（多选/拖拽/粘贴）→ 预览账目 → 确认导入。
 *
 * 与岗位广场的 JobImportModal 同一套两步流，但字段集更小（候选没有 JD 结构与收藏）。
 * 多文件的解析/去重/上限/分块共用 `features/import/useCsvFileBatch`，只有判重身份不同：
 * 候选按「岗位名 + 岗位链接」。
 *
 * 结果提示走 `message`（Toast）而不是 `modal.*`：视图已经在抽屉里，再开弹窗就是第二层容器。
 */
import { DownloadOutlined, InboxOutlined } from "@ant-design/icons";
import { Alert, App, Button, Flex, Listy, Space, Tag, Typography, Upload } from "antd";
import { useState } from "react";
import type { ClipboardEvent } from "react";
import { importCandidatesCsv, previewCandidateImport } from "../../../api/candidateJob";
import { commitRowsInChunks, useCsvFileBatch } from "../../../features/import/useCsvFileBatch";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { CandidateCsvRow } from "../../../types";
import { downloadCsvTemplate } from "../../../utils/download";
import { ListyItem } from "../../common/ListyItem";

interface CsvRowError {
  line: number;
  message: string;
  code: "duplicate" | "invalid" | "error";
}

interface Props {
  onClose: () => void;
  /** 导入成功后由抽屉刷新列表并回到列表视图。 */
  onImported: (imported: number) => void;
}

/** 候选的判重身份：岗位名 + 岗位链接（归一化后逐字比较）。 */
function candidateRowKey(row: CandidateCsvRow): string {
  const data = row.data ?? {};
  const link = data.source_url ?? data.link ?? data.url ?? "";
  return [data.title, link].map((value) => (value ?? "").trim().toLowerCase()).join("|");
}

export function CandidateImportView({ onClose, onImported }: Props) {
  const { message } = App.useApp();
  useLocale();
  /** Clipboard text is wrapped as a CSV file; its filename follows the active UI locale. */
  const pastedFileName = t("jobs.candidate.import.pasted-file");
  const [committing, setCommitting] = useState(false);
  const batch = useCsvFileBatch<CandidateCsvRow, CsvRowError>({
    parseFile: async (file) => {
      const result = await previewCandidateImport(file);
      return { rows: result.rows, errors: result.errors };
    },
    dedupeKey: candidateRowKey,
  });
  const busy = batch.parsing || committing;

  const close = () => {
    if (committing) return;
    batch.reset();
    onClose();
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (busy) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    // 从表格复制出来的是纯文本：包装成一个 CSV 文件交给后端按表头解析。
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (files.length === 0 && !text.trim()) return;
    event.preventDefault();
    void batch.addFiles(
      files.length > 0 ? files : [new File([text], pastedFileName, { type: "text/csv" })],
    );
  };

  const confirmImport = async () => {
    if (!batch.canCommit || committing) return;
    setCommitting(true);
    try {
      const outcome = await commitRowsInChunks<CandidateCsvRow, CsvRowError>({
        // 剥掉前端附加的 sourceFile：后端只认 {line, data}。
        rows: batch.rows.map((row) => ({ line: row.line, data: row.data })),
        commitRows: (chunk) => importCandidatesCsv(chunk),
      });
      if (outcome.imported > 0) onImported(outcome.imported);
      if (outcome.failedChunk !== undefined) {
        message.error(
          t("jobs.candidate.import.failed-chunk", {
            chunk: outcome.failedChunk,
            imported: outcome.imported,
            message: outcome.failedMessage ?? t("jobs.candidate.import.failed-retry"),
          }),
        );
        return;
      }
      const skipped = outcome.failed.filter((item) => item.code === "duplicate").length;
      const detail = t("jobs.candidate.import.done-detail", {
        imported: outcome.imported,
        skipped,
        failed: outcome.failed.length - skipped,
      });
      // 有失败行就保留预览：用户改完文件可以再导一次。
      if (outcome.failed.length > skipped) {
        message.warning(detail);
        return;
      }
      message.success(outcome.imported > 0 ? detail : t("jobs.candidate.import.no-rows"));
      batch.reset();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("jobs.candidate.import.failed"));
    } finally {
      setCommitting(false);
    }
  };

  const rows = batch.rows;
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Typography.Text type="secondary">{t("jobs.candidate.import.intro")}</Typography.Text>
      <div
        role="group"
        aria-label={t("jobs.candidate.import.region")}
        tabIndex={0}
        onPaste={handlePaste}
      >
        <Upload.Dragger
          accept=".csv,text/csv"
          multiple
          showUploadList={false}
          disabled={busy}
          // 返回 false 阻止 antd 自动上传：文件只交给本地批量状态机。
          beforeUpload={(file) => {
            void batch.addFiles([file]);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{t("jobs.candidate.import.drop")}</p>
          <p className="ant-upload-hint">{t("jobs.candidate.import.hint")}</p>
        </Upload.Dragger>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          {t("jobs.candidate.import.paste-hint")}
        </Typography.Text>
      </div>

      {busy ? (
        <Typography.Text type="secondary">{t("jobs.candidate.import.parsing")}</Typography.Text>
      ) : null}
      {batch.notice ? <Alert type="warning" showIcon title={batch.notice} /> : null}

      {batch.files.length > 0 ? (
        <div>
          <Space wrap size={8}>
            <Typography.Text strong>
              {t("jobs.candidate.import.summary", { files: batch.files.length, rows: rows.length })}
            </Typography.Text>
            {batch.errors.length > 0 ? (
              <Typography.Text type="warning">
                {t("jobs.candidate.import.errors-count", { count: batch.errors.length })}
              </Typography.Text>
            ) : null}
            {batch.duplicates > 0 ? (
              <Typography.Text type="secondary">
                {t("jobs.candidate.import.duplicates-count", { count: batch.duplicates })}
              </Typography.Text>
            ) : null}
          </Space>
          <Listy
            items={batch.files}
            rowKey={(item) => item.id}
            itemRender={(item) => (
              <ListyItem>
                <Flex justify="space-between" gap={12} wrap>
                  <Typography.Text>{item.file}</Typography.Text>
                  <Space size={8} wrap>
                    {item.status === "parsing" ? (
                      <Tag color="processing">{t("jobs.candidate.import.file-parsing")}</Tag>
                    ) : null}
                    {item.status === "ok" ? (
                      <Tag color="success">
                        {t("jobs.candidate.import.file-ok", { count: item.importable })}
                      </Tag>
                    ) : null}
                    {item.status === "error" ? (
                      <Tag color="error">{t("jobs.candidate.import.file-error")}</Tag>
                    ) : null}
                    {item.errorCount > 0 ? (
                      <Tag color="warning">
                        {t("jobs.candidate.import.errors-count", { count: item.errorCount })}
                      </Tag>
                    ) : null}
                    {item.duplicates > 0 ? (
                      <Tag>
                        {t("jobs.candidate.import.file-duplicates", { count: item.duplicates })}
                      </Tag>
                    ) : null}
                    <Button
                      type="link"
                      size="small"
                      disabled={busy || undefined}
                      onClick={() => batch.removeFile(item.id)}
                    >
                      {t("jobs.candidate.import.remove-file")}
                    </Button>
                  </Space>
                </Flex>
                {item.message ? (
                  <Typography.Text type="danger">{item.message}</Typography.Text>
                ) : null}
              </ListyItem>
            )}
          />
        </div>
      ) : null}

      {batch.errors.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={t("jobs.candidate.import.errors-title")}
          description={
            <Listy
              items={batch.errors.slice(0, 10)}
              rowKey={(item) => `${item.sourceFile}#${item.line}`}
              itemRender={(item) => (
                <ListyItem>
                  <Tag>{item.sourceFile}</Tag>
                  {t("jobs.candidate.import.errors-line", {
                    line: item.line,
                    message: item.message,
                  })}
                </ListyItem>
              )}
            />
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <div>
          <Typography.Text type="secondary">{t("jobs.candidate.import.preview")}</Typography.Text>
          <Listy
            items={rows.slice(0, 10)}
            rowKey={(item) => `${item.sourceFile}#${item.line}`}
            itemRender={(item) => (
              <ListyItem>
                {t("jobs.candidate.import.preview-line", {
                  line: item.line,
                  title: item.data.title || t("jobs.candidate.import.no-title"),
                })}
                {item.data.company
                  ? ` ${t("jobs.candidate.import.preview-meta", {
                      company: item.data.company,
                      file: item.sourceFile,
                    })}`
                  : ` · ${item.sourceFile}`}
              </ListyItem>
            )}
          />
        </div>
      ) : null}

      {/* 视图自带操作行：左「下载空模板」、右「取消 / 确认导入」。 */}
      <Flex justify="space-between" align="center">
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={() =>
            downloadCsvTemplate(t("jobs.candidate.import.template-file"), [
              t("jobs.candidate.import.col-title"),
              t("jobs.candidate.import.col-company"),
              t("jobs.candidate.import.col-url"),
              t("jobs.candidate.import.col-raw"),
              t("jobs.candidate.import.col-note"),
            ])
          }
        >
          {t("jobs.candidate.import.download-template")}
        </Button>
        <Space>
          <Button onClick={close} disabled={committing || undefined}>
            {t("common.action.cancel")}
          </Button>
          <Button
            type="primary"
            disabled={!batch.canCommit}
            loading={committing}
            onClick={() => void confirmImport()}
          >
            {t("jobs.candidate.import.confirm", { count: rows.length })}
          </Button>
        </Space>
      </Flex>
    </Space>
  );
}

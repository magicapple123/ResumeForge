// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位 CSV 导入弹窗：选文件（可多选/拖拽/粘贴）→ 预览确认（逐行错误与重复检查）→ 提交导入。
 * 解析在后端做（UTF-8/GBK、表头别名、逐行报错），前端只负责把预览结果讲清楚：
 * 用户在确认前就知道哪些行能进、哪些行会被跳过、为什么。
 *
 * 多文件的账目（串行解析、坏文件隔离、去重、上限、按 500 行分块提交）在
 * `features/import/useCsvFileBatch` 里，与备选岗位导入共用同一套口径。
 */
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Flex, Listy, Modal, Space, Tag, Typography, Upload } from "antd";
import { ListyItem } from "../common/ListyItem";
import { useState } from "react";
import type { ClipboardEvent } from "react";
import { importJobs, previewJobImport } from "../../api/jobs";
import type { JobImportRow } from "../../types";
import { downloadCsvTemplate } from "../../utils/download";
import { commitRowsInChunks, useCsvFileBatch } from "../../features/import/useCsvFileBatch";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface CsvRowError {
  line: number;
  message: string;
}

/** 岗位的判重身份：公司 + 岗位名 + 投递链接（归一化后逐字比较）。 */
function jobRowKey(row: JobImportRow): string {
  const data = row.data ?? {};
  const url = data.source_url ?? data.url ?? data.link ?? "";
  return [data.company, data.title, url]
    .map((value) => (value ?? "").trim().toLowerCase())
    .join("|");
}

export function JobImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  /** 导入成功（哪怕部分失败）后刷新列表。 */
  onImported: () => void;
}) {
  const { message } = App.useApp();
  // 本弹窗用模块级 t()：必须订阅语言变化。
  useLocale();
  const [committing, setCommitting] = useState(false);
  const batch = useCsvFileBatch<JobImportRow, CsvRowError>({
    parseFile: async (file) => {
      const result = await previewJobImport(file);
      return { rows: result.rows, errors: result.errors };
    },
    dedupeKey: jobRowKey,
  });

  const close = () => {
    if (committing) return;
    batch.reset();
    onClose();
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (committing || batch.parsing) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      void batch.addFiles(files);
      return;
    }
    // 从 Excel / 表格里复制出来的是纯文本：当作一个 CSV 文件交给后端解析，
    // 列顺序与模板一致即可（首行表头照常参与别名匹配）。
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text.trim()) return;
    event.preventDefault();
    void batch.addFiles([new File([text], "粘贴内容.csv", { type: "text/csv" })]);
  };

  const commit = async () => {
    if (!batch.canCommit || committing) return;
    setCommitting(true);
    try {
      const outcome = await commitRowsInChunks<JobImportRow, CsvRowError>({
        // 提交时剥掉前端附加的 sourceFile：后端只认 {line, data}。
        rows: batch.rows.map((row) => ({ line: row.line, data: row.data })),
        commitRows: (chunk) => importJobs(chunk),
      });
      onImported();
      if (outcome.imported > 0) {
        message.success(t("jobImport.toast.imported", { count: outcome.imported }));
      }
      if (outcome.failedChunk !== undefined) {
        // 停在失败块：后续块没提交，账目只说已成功的那部分。
        message.error(
          t("jobImport.toast.chunkFailed", {
            chunk: outcome.failedChunk,
            imported: outcome.imported,
            message: outcome.failedMessage ?? t("jobImport.toast.retryHint"),
          }),
        );
        return;
      }
      const skipped = outcome.failed.filter((item) => item.message.includes("已跳过")).length;
      const failed = outcome.failed.length - skipped;
      if (skipped > 0) {
        message.info(t("jobImport.toast.duplicates", { count: skipped }));
      }
      if (failed > 0) {
        message.warning(t("jobImport.toast.failed", { count: failed }));
        // 失败行保留在预览里，用户改完 CSV 可以只重导这些行。
        return;
      }
      // 全成功（没有任何失败行）才关闭：有失败就留着预览，方便用户只重导那些行。
      batch.reset();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("jobImport.toast.failedGeneric"));
    } finally {
      setCommitting(false);
    }
  };

  const rows = batch.rows;
  const errors = batch.errors;

  return (
    <Modal
      title={t("jobImport.title")}
      open={open}
      onCancel={close}
      width={640}
      /* 「下载空模板」放进 footer 左侧（用户反馈：与取消/确认分处两行、基线不齐）——
         自定义 footer 左右两组按钮天然同一行。 */
      footer={
        <Flex justify="space-between" align="center">
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() =>
              downloadCsvTemplate(t("jobImport.template.fileName"), [
                "岗位名称",
                "公司名称",
                "工作地点",
                "薪资范围",
                "岗位类型",
                "状态",
                "投递链接",
                "发布时间",
                "岗位描述",
                "任职要求",
                "其他招聘信息",
                "备注",
                "收藏",
              ])
            }
          >
            {t("jobImport.action.downloadTemplate")}
          </Button>
          <Space>
            <Button disabled={batch.parsing || committing} onClick={close}>
              {t("common.action.cancel")}
            </Button>
            <Button
              type="primary"
              disabled={!batch.canCommit}
              loading={committing}
              onClick={() => void commit()}
            >
              {t("jobImport.action.confirm", { count: rows.length })}
            </Button>
          </Space>
        </Flex>
      }
    >
      {/* 整块导入区都可粘贴：拖拽进文件、或者从表格复制一片内容按 Ctrl+V。 */}
      <div
        role="group"
        aria-label={t("jobImport.dropzone.aria")}
        tabIndex={0}
        onPaste={handlePaste}
        style={{ outline: "none" }}
      >
        <Upload.Dragger
          accept=".csv,text/csv"
          multiple
          showUploadList={false}
          disabled={batch.parsing || committing}
          // 返回 false 阻止 antd 自动上传：文件只交给本地批量状态机。
          beforeUpload={(file) => {
            void batch.addFiles([file]);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <UploadOutlined />
          </p>
          <p className="ant-upload-text">{t("jobImport.dropzone.text")}</p>
          <p className="ant-upload-hint">{t("jobImport.dropzone.hint1")}</p>
        </Upload.Dragger>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          {t("jobImport.dropzone.hint2")}
        </Typography.Text>
      </div>

      {batch.parsing && (
        <Typography.Text type="secondary">{t("jobImport.parsing")}</Typography.Text>
      )}

      {batch.notice && (
        <Alert type="warning" showIcon style={{ marginTop: 8 }} title={batch.notice} />
      )}

      {batch.files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text strong>
            {t("jobImport.summary", { files: batch.files.length, rows: rows.length })}
            {errors.length > 0 ? t("jobImport.summary.errors", { count: errors.length }) : ""}
            {batch.duplicates > 0
              ? t("jobImport.summary.duplicates", { count: batch.duplicates })
              : ""}
          </Typography.Text>
          <Listy
            items={batch.files}
            rowKey={(item) => item.id}
            itemRender={(item) => (
              <ListyItem>
                <Flex justify="space-between" gap={12} wrap>
                  <Typography.Text>{item.file}</Typography.Text>
                  <Space size={8} wrap>
                    {item.status === "parsing" && (
                      <Tag color="processing">{t("jobImport.tag.parsing")}</Tag>
                    )}
                    {item.status === "ok" && (
                      <Tag color="success">
                        {t("jobImport.tag.importable", { count: item.importable })}
                      </Tag>
                    )}
                    {item.status === "error" && (
                      <Tag color="error">{t("jobImport.tag.parseFailed")}</Tag>
                    )}
                    {item.errorCount > 0 && (
                      <Tag color="warning">
                        {t("jobImport.tag.errorRows", { count: item.errorCount })}
                      </Tag>
                    )}
                    {item.duplicates > 0 && (
                      <Tag>{t("jobImport.tag.duplicates", { count: item.duplicates })}</Tag>
                    )}
                    <Button
                      type="link"
                      size="small"
                      disabled={batch.parsing || committing}
                      onClick={() => batch.removeFile(item.id)}
                    >
                      {t("jobImport.action.remove")}
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
      )}

      {errors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
          title={t("jobImport.skipped.title")}
          description={
            <Listy
              items={errors.slice(0, 10)}
              rowKey={(item) => `${item.sourceFile}#${item.line}`}
              itemRender={(item) => (
                <ListyItem>
                  <Tag>{item.sourceFile}</Tag>
                  <Tag>{t("jobImport.skipped.line", { line: item.line })}</Tag>
                  {item.message}
                </ListyItem>
              )}
            />
          }
        />
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">{t("jobImport.preview.title")}</Typography.Text>
          <Listy
            items={rows.slice(0, 10)}
            rowKey={(item) => `${item.sourceFile}#${item.line}`}
            itemRender={(item) => (
              <ListyItem>
                <Flex justify="space-between" gap={12}>
                  <Typography.Text strong>
                    {item.data.title || t("jobImport.untitled")}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {item.data.company || "—"}
                    {item.data.origin_source
                      ? ` · ${t("jobImport.preview.source", { source: item.data.origin_source })}`
                      : ""}
                    {` · ${item.sourceFile}`}
                  </Typography.Text>
                </Flex>
              </ListyItem>
            )}
          />
        </div>
      )}
    </Modal>
  );
}

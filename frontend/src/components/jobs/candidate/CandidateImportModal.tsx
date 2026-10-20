// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位 CSV 导入弹窗：上传（多选/拖拽/粘贴）→ 预览账目 → 确认导入。
 *
 * 与岗位广场的 JobImportModal 同一套两步流，但字段集更小（候选没有 JD 结构与
 * 收藏），预览里直接展示每行的岗位名 + 公司，方便用户核对再入库。
 * 多文件的解析/去重/上限/分块与岗位导入共用 `features/import/useCsvFileBatch`，
 * 只有判重身份不同：候选按 `岗位名 + 岗位链接`。
 */
import { DownloadOutlined, InboxOutlined } from "@ant-design/icons";
import { Alert, App, Button, Flex, Listy, Modal, Space, Tag, Typography, Upload } from "antd";
import { ListyItem } from "../../common/ListyItem";
import { useState } from "react";
import type { ClipboardEvent } from "react";
import { importCandidatesCsv, previewCandidateImport } from "../../../api/candidateJob";
import type { CandidateCsvRow } from "../../../types";
import { downloadCsvTemplate } from "../../../utils/download";
import { commitRowsInChunks, useCsvFileBatch } from "../../../features/import/useCsvFileBatch";

interface CsvRowError {
  line: number;
  message: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入成功后由抽屉刷新列表。 */
  onImported: (imported: number) => void;
}

/** 候选的判重身份：岗位名 + 岗位链接（归一化后逐字比较）。 */
function candidateRowKey(row: CandidateCsvRow): string {
  const data = row.data ?? {};
  const link = data.source_url ?? data.link ?? data.url ?? "";
  return [data.title, link].map((value) => (value ?? "").trim().toLowerCase()).join("|");
}

export function CandidateImportModal({ open, onClose, onImported }: Props) {
  const { modal } = App.useApp();
  const [committing, setCommitting] = useState(false);
  const batch = useCsvFileBatch<CandidateCsvRow, CsvRowError>({
    parseFile: async (file) => {
      const result = await previewCandidateImport(file);
      return { rows: result.rows, errors: result.errors };
    },
    dedupeKey: candidateRowKey,
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
    // 从表格复制出来的是纯文本：包装成一个 CSV 文件交给后端按表头解析。
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text.trim()) return;
    event.preventDefault();
    void batch.addFiles([new File([text], "粘贴内容.csv", { type: "text/csv" })]);
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
      if (outcome.imported > 0) {
        onImported(outcome.imported);
      }
      if (outcome.failedChunk !== undefined) {
        modal.error({
          title: "导入中断",
          content: `第 ${outcome.failedChunk} 批导入失败（已导入 ${outcome.imported} 条）：${
            outcome.failedMessage ?? "请检查网络后重试"
          }`,
        });
        return;
      }
      const skipped = outcome.failed.filter((item) => item.message.includes("已跳过")).length;
      const failed = outcome.failed.length - skipped;
      const details = [
        outcome.imported > 0 ? `导入 ${outcome.imported} 条` : "",
        skipped > 0 ? `重复跳过 ${skipped} 条` : "",
        failed > 0 ? `失败 ${failed} 条` : "",
      ].filter(Boolean);
      if (failed > 0) {
        // 有失败行就保留预览：用户改完文件可以再导一次。
        modal.warning({ title: "CSV 导入完成", content: details.join("，") });
        return;
      }
      modal.success({ title: "CSV 导入完成", content: details.join("，") || "没有可导入的行" });
      batch.reset();
      onClose();
    } catch (error) {
      modal.error({
        title: "导入失败",
        content: error instanceof Error ? error.message : "导入失败，请重试",
      });
    } finally {
      setCommitting(false);
    }
  };

  const rows = batch.rows;
  const errors = batch.errors;

  return (
    <Modal
      title="导入备选岗位 CSV"
      open={open}
      onCancel={close}
      okText="确认导入"
      okButtonProps={{ disabled: !batch.canCommit, loading: committing }}
      width={640}
      /* 「下载空模板」放进 footer 左侧（用户反馈：与取消/确认分处两行、基线不齐）——
         自定义 footer 左右两组按钮天然同一行。 */
      footer={
        <Flex justify="space-between" align="center">
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() =>
              downloadCsvTemplate("备选岗位导入模板.csv", [
                "岗位名称",
                "公司名称",
                "岗位链接",
                "招聘原文",
                "备注",
              ])
            }
          >
            下载空模板
          </Button>
          <Space>
            <Button disabled={committing} onClick={close}>
              取消
            </Button>
            <Button
              type="primary"
              disabled={!batch.canCommit}
              loading={committing}
              onClick={() => void confirmImport()}
            >
              确认导入 {rows.length} 条
            </Button>
          </Space>
        </Flex>
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          这里导入的是<strong>备选岗位</strong>（先暂存在这个抽屉里，之后点卡片上的「导入到岗位」
          才会进入岗位广场）——与岗位广场的 CSV 导入是两条独立通道，别混用两份文件。
        </Typography.Text>
        <div
          role="group"
          aria-label="CSV 导入区"
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
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽 CSV 文件到这里（可多选）</p>
            <p className="ant-upload-hint">
              第一行是表头（岗位名称 / 公司名称 / 岗位链接 / 招聘原文 / 备注），
              也可以先下载空模板照着填；一次最多 10 个文件、合计 2000 行
            </p>
          </Upload.Dragger>
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            也可以直接在这块区域按 Ctrl+V 粘贴从表格复制的 CSV 内容
          </Typography.Text>
        </div>

        {batch.parsing && <Typography.Text type="secondary">正在解析…</Typography.Text>}

        {batch.notice && <Alert type="warning" showIcon title={batch.notice} />}

        {batch.files.length > 0 && (
          <div>
            <Typography.Text strong>
              已选 {batch.files.length} 个文件：合计可导入 {rows.length} 条
              {errors.length > 0 ? `，${errors.length} 行有问题` : ""}
              {batch.duplicates > 0 ? `，已去除重复 ${batch.duplicates} 行` : ""}
            </Typography.Text>
            <Listy
              items={batch.files}
              rowKey={(item) => item.id}
              itemRender={(item) => (
                <ListyItem>
                  <Flex justify="space-between" gap={12} wrap>
                    <Typography.Text>{item.file}</Typography.Text>
                    <Space size={8} wrap>
                      {item.status === "parsing" && <Tag color="processing">解析中…</Tag>}
                      {item.status === "ok" && (
                        <Tag color="success">可导入 {item.importable} 条</Tag>
                      )}
                      {item.status === "error" && <Tag color="error">解析失败</Tag>}
                      {item.errorCount > 0 && <Tag color="warning">{item.errorCount} 行有问题</Tag>}
                      {item.duplicates > 0 && <Tag>重复 {item.duplicates} 行</Tag>}
                      <Button
                        type="link"
                        size="small"
                        disabled={batch.parsing || committing}
                        onClick={() => batch.removeFile(item.id)}
                      >
                        移除
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
            title="以下行不会导入（改好 CSV 后可以重新选择文件）"
            description={
              <Listy
                items={errors.slice(0, 10)}
                rowKey={(item) => `${item.sourceFile}#${item.line}`}
                itemRender={(item) => (
                  <ListyItem>
                    <Tag>{item.sourceFile}</Tag>第 {item.line} 行：{item.message}
                  </ListyItem>
                )}
              />
            }
          />
        )}

        {rows.length > 0 && (
          <div>
            <Typography.Text type="secondary">前几条预览</Typography.Text>
            <Listy
              items={rows.slice(0, 10)}
              rowKey={(item) => `${item.sourceFile}#${item.line}`}
              itemRender={(item) => (
                <ListyItem>
                  第 {item.line} 行：{item.data.title || "（无岗位名）"}
                  {item.data.company ? ` · ${item.data.company}` : ""}
                  {` · ${item.sourceFile}`}
                </ListyItem>
              )}
            />
          </div>
        )}
      </Space>
    </Modal>
  );
}

/**
 * 备选岗位 CSV 导入弹窗：上传 → 预览账目 → 确认导入。
 *
 * 与岗位广场的 JobImportModal 同一套两步流，但字段集更小（候选没有 JD 结构与
 * 收藏），预览里直接展示每行的岗位名 + 公司，方便用户核对再入库。
 */
import { DownloadOutlined, InboxOutlined } from "@ant-design/icons";
import { Alert, Button, Flex, List, Modal, Space, Typography, Upload } from "antd";
import { useState } from "react";
import { importCandidatesCsv, previewCandidateImport } from "../../../api/candidateJob";
import type { CandidateCsvPreview } from "../../../types";
import { downloadCsvTemplate } from "../../../utils/download";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入成功后由抽屉刷新列表。 */
  onImported: (imported: number) => void;
}

export function CandidateImportModal({ open, onClose, onImported }: Props) {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<CandidateCsvPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const reset = () => {
    setFileName("");
    setPreview(null);
    setParsing(false);
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setParsing(true);
    setPreview(null);
    try {
      setPreview(await previewCandidateImport(file));
    } catch (error) {
      Modal.error({
        title: "解析失败",
        content: error instanceof Error ? error.message : "读取文件失败，请重试",
      });
    } finally {
      setParsing(false);
    }
    // 阻止 Upload 的自动上传：文件在预览步骤就交给后端了，不需要 action。
    return false;
  };

  const confirmImport = async () => {
    if (!preview || preview.rows.length === 0 || committing) return;
    setCommitting(true);
    try {
      const result = await importCandidatesCsv(preview.rows);
      const skipped = result.failed.filter((item) => item.message.includes("已跳过")).length;
      const failed = result.failed.length - skipped;
      const details = [
        result.imported > 0 ? `导入 ${result.imported} 条` : "",
        skipped > 0 ? `重复跳过 ${skipped} 条` : "",
        failed > 0 ? `失败 ${failed} 条` : "",
      ].filter(Boolean);
      if (result.imported > 0) {
        onImported(result.imported);
      }
      Modal.success({
        title: "CSV 导入完成",
        content: details.join("，") || "没有可导入的行",
      });
      reset();
      onClose();
    } catch (error) {
      Modal.error({
        title: "导入失败",
        content: error instanceof Error ? error.message : "导入失败，请重试",
      });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Modal
      title="导入备选岗位 CSV"
      open={open}
      onCancel={() => {
        if (!committing) {
          reset();
          onClose();
        }
      }}
      onOk={() => void confirmImport()}
      okText="确认导入"
      okButtonProps={{ disabled: !preview || preview.rows.length === 0, loading: committing }}
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
            <Button
              disabled={committing}
              onClick={() => {
                if (!committing) {
                  reset();
                  onClose();
                }
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              disabled={!preview || preview.rows.length === 0}
              loading={committing}
              onClick={() => void confirmImport()}
            >
              确认导入
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
        <Upload.Dragger
          accept=".csv,text/csv"
          maxCount={1}
          showUploadList={false}
          disabled={parsing || committing}
          beforeUpload={(file) => void handleFile(file)}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽 CSV 文件到这里</p>
          <p className="ant-upload-hint">
            第一行是表头（岗位名称 / 公司名称 / 岗位链接 / 招聘原文 / 备注），
            也可以先下载空模板照着填
          </p>
        </Upload.Dragger>
        {parsing && <Typography.Text type="secondary">正在解析…</Typography.Text>}

        {preview && (
          <div>
            <Typography.Text strong>
              {fileName}：可导入 {preview.rows.length} 条
              {preview.errors.length > 0 ? `，${preview.errors.length} 行有问题` : ""}
            </Typography.Text>
            {preview.errors.length > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 8 }}
                message="以下行不会导入（改好 CSV 后可以重新选择文件）"
                description={
                  <List
                    size="small"
                    dataSource={preview.errors.slice(0, 10)}
                    renderItem={(item) => (
                      <List.Item>
                        第 {item.line} 行：{item.message}
                      </List.Item>
                    )}
                  />
                }
              />
            )}
            {preview.rows.length > 0 && (
              <List
                size="small"
                style={{ marginTop: 8 }}
                header={<Typography.Text type="secondary">前几条预览</Typography.Text>}
                dataSource={preview.rows.slice(0, 5)}
                renderItem={(row) => (
                  <List.Item>
                    第 {row.line} 行：{row.data.title || "（无岗位名）"}
                    {row.data.company ? ` · ${row.data.company}` : ""}
                  </List.Item>
                )}
              />
            )}
          </div>
        )}
      </Space>
    </Modal>
  );
}

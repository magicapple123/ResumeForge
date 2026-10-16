/**
 * 岗位 CSV 导入弹窗：选文件 → 预览确认（逐行错误与重复检查）→ 提交导入。
 * 解析在后端做（UTF-8/GBK、表头别名、逐行报错），前端只负责把预览结果讲清楚：
 * 用户在确认前就知道哪些行能进、哪些行会被跳过、为什么。
 */
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Flex, Listy, Modal, Space, Tag, Typography, Upload } from "antd";
import { ListyItem } from "../common/ListyItem";
import { useState } from "react";
import { importJobs, previewJobImport } from "../../api/jobs";
import type { JobImportPreview } from "../../types";
import { downloadCsvTemplate } from "../../utils/download";

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
  const [preview, setPreview] = useState<JobImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const reset = () => {
    setPreview(null);
    setFileName("");
    setParsing(false);
    setCommitting(false);
  };

  const close = () => {
    if (parsing || committing) return;
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setFileName(file.name);
    try {
      const result = await previewJobImport(file);
      setPreview(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "解析 CSV 失败");
    } finally {
      setParsing(false);
    }
    // 返回 false 阻止 antd Upload 自动上传：文件内容已经交给预览流程了。
    return false;
  };

  const commit = async () => {
    if (!preview || preview.rows.length === 0) return;
    setCommitting(true);
    try {
      const result = await importJobs(preview.rows);
      onImported();
      const skipped = result.failed.filter((item) => item.message.includes("已跳过")).length;
      const failed = result.failed.length - skipped;
      if (result.imported > 0) {
        message.success(`已导入 ${result.imported} 个岗位`);
      }
      if (skipped > 0) {
        message.info(`${skipped} 行与已有岗位重复，已跳过`);
      }
      if (failed > 0) {
        message.warning(`${failed} 行导入失败，详见弹窗中的错误列表`);
        // 失败行保留在预览里，用户改完 CSV 可以只重导这些行。
        setPreview({ ...preview, rows: [] });
        return;
      }
      reset();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setCommitting(false);
    }
  };

  const rows = preview?.rows ?? [];
  const errors = preview?.errors ?? [];

  return (
    <Modal
      title="导入岗位 CSV"
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
              downloadCsvTemplate("岗位导入模板.csv", [
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
            下载空模板
          </Button>
          <Space>
            <Button disabled={parsing || committing} onClick={close}>
              取消
            </Button>
            <Button
              type="primary"
              disabled={rows.length === 0}
              loading={committing}
              onClick={() => void commit()}
            >
              确认导入 {rows.length} 条
            </Button>
          </Space>
        </Flex>
      }
    >
      <Upload.Dragger
        accept=".csv,text/csv"
        maxCount={1}
        showUploadList={false}
        disabled={parsing || committing}
        beforeUpload={(file) => void handleFile(file)}
      >
        <p className="ant-upload-drag-icon">
          <UploadOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽 CSV 文件到这里</p>
        <p className="ant-upload-hint">
          第一行是表头（岗位名称 / 公司名称 / 工作地点 / 薪资范围 / 岗位类型 / 状态 / 投递链接 /
          发布时间…），也可以先用「导出 CSV」拿一份现成模板
        </p>
      </Upload.Dragger>

      {parsing && <Typography.Text type="secondary">正在解析…</Typography.Text>}

      {preview && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text strong>
            {fileName}：可导入 {rows.length} 条
            {errors.length > 0 ? `，${errors.length} 行有问题` : ""}
          </Typography.Text>
          {errors.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              title="以下行不会导入（改好 CSV 后可以重新选择文件）"
              description={
                <Listy
                  items={errors}
                  rowKey={(item) => item.line}
                  itemRender={(item) => (
                    <ListyItem>
                      <Tag>第 {item.line} 行</Tag>
                      {item.message}
                    </ListyItem>
                  )}
                />
              }
            />
          )}
          {rows.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">将导入以下岗位（最多显示前 10 条）</Typography.Text>
              <Listy
                items={rows.slice(0, 10)}
                rowKey={(item) => item.line}
                itemRender={(item) => (
                  <ListyItem>
                    <Flex justify="space-between" gap={12}>
                      <Typography.Text strong>{item.data.title || "（无标题）"}</Typography.Text>
                      <Typography.Text type="secondary">
                        {item.data.company || "—"}
                        {item.data.origin_source ? ` · 来源：${item.data.origin_source}` : ""}
                      </Typography.Text>
                    </Flex>
                  </ListyItem>
                )}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

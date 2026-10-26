// SPDX-License-Identifier: Apache-2.0
/** 离线分享包：选择分享版本 + 权限 + 脱敏范围 → 生成 → 展示本地路径 / 文件清单 / 评论导入。 */
import { CopyOutlined, DownloadOutlined, FolderOpenOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Descriptions,
  Input,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { RowActions } from "./common/RowActions";
import { TRASH_RECOVERY_NOTE } from "./common/rowActionMenu";
import { useState } from "react";
import {
  createSharePackage,
  deleteSharePackage,
  downloadSharePackageFile,
  getSharePackageComments,
  importSharePackageComments,
  revealSharePackage,
} from "../api/sharePackages";
import { downloadResumeShareZip } from "../api/resumes";
import type { SharePackageDetail } from "../types";
import type { ResumeContent } from "../types/resume";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import { createReviewAnnotationApi } from "../features/resume-review";
import ReviewAnnotationsPanel from "./resume/review/ReviewAnnotationsPanel";
import {
  DEFAULT_REDACTION_OPTIONS,
  REDACTION_FIELDS,
  type RedactionOptions,
} from "../types/export";
import { SHARE_PERMISSIONS, type SharePermission } from "../types/sharePackage";
import { copyText } from "../utils/clipboard";
import { downloadBlob } from "../utils/download";
import { formatBytes } from "../utils/format";

interface Props {
  recordId: number;
  open: boolean;
  onClose: () => void;
  /** 批注「定位」：宿主把当前对象路径交给画布/大纲（不传则只展示对象名）。 */
  onLocateAnnotation?: (path: string) => void;
}

/**
 * 批注接口适配器只创建一次（模块级单例）：面板的加载 effect 以 api 为依赖，
 * 每次渲染新建对象会让它反复重新拉取。
 */
const reviewApi = createReviewAnnotationApi();

/** 从文件清单的第一个文件路径反推分享包目录。 */
function deriveDirectory(detail: SharePackageDetail | null): string {
  const first = detail?.files?.[0]?.path;
  if (!first) return "";
  return first.replace(/[/\\][^/\\]*$/, "");
}

export default function SharePackageModal({ recordId, open, onClose, onLocateAnnotation }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [permission, setPermission] = useState<SharePermission>("read_only");
  const [redactOptions, setRedactOptions] = useState<RedactionOptions>(DEFAULT_REDACTION_OPTIONS);
  const [includePhoto, setIncludePhoto] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<SharePackageDetail | null>(null);
  const [comments, setComments] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentFormat, setCommentFormat] = useState<"markdown" | "json">("markdown");
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const [zipLoading, setZipLoading] = useState(false);

  // 体积只按后端文件清单里的实际 size 求和，不按内容去猜：生成前没有产物就明说
  // 「生成后统计」，不给一个看起来很准、实际对不上的数字。
  const fileCount = result?.files.length ?? 0;
  const totalBytes = (result?.files ?? []).reduce((sum, file) => sum + file.size, 0);

  const downloadZip = async () => {
    if (zipLoading) return;
    setZipLoading(true);
    try {
      const { blob, filename } = await downloadResumeShareZip(recordId);
      downloadBlob(blob, filename);
      message.success("离线包已开始下载");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "生成离线包失败");
    } finally {
      setZipLoading(false);
    }
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setResult(null);
    setComments("");
    try {
      const detail = await createSharePackage({
        resume_id: recordId,
        permission,
        redact_options: redactOptions,
        include_photo: includePhoto,
      });
      setResult(detail);
      if (detail.permission === "comment") {
        try {
          setComments((await getSharePackageComments(detail.id)).content);
        } catch {
          // 评论文件读取失败不阻断主流程，导入时仍可再试。
        }
      }
      message.success("分享包已生成");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "生成分享包失败");
    } finally {
      setGenerating(false);
    }
  };

  const importComments = async () => {
    if (!result || importing) return;
    if (!commentText.trim()) {
      message.warning("请先粘贴或填写收件人回传的评论");
      return;
    }
    setImporting(true);
    try {
      const imported = await importSharePackageComments(result.id, {
        content: commentText,
        format: commentFormat,
      });
      setComments(imported.content);
      setCommentText("");
      message.success("评论已导入");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导入评论失败");
    } finally {
      setImporting(false);
    }
  };

  const downloadFile = async (detail: SharePackageDetail, filename: string) => {
    setDownloading(filename);
    try {
      const file = await downloadSharePackageFile(detail.id, filename);
      downloadBlob(file.blob, file.filename);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "下载文件失败");
    } finally {
      setDownloading(null);
    }
  };

  const removePackage = async () => {
    if (!result || deleting) return;
    setDeleting(true);
    try {
      await deleteSharePackage(result.id);
      message.success("分享包已移入回收站，可在「回收站」里恢复");
      setResult(null);
      setComments("");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除分享包失败");
    } finally {
      setDeleting(false);
    }
  };

  const openDirectory = async () => {
    if (!result || revealing) return;
    setRevealing(true);
    try {
      await revealSharePackage(result.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "打开文件夹失败");
    } finally {
      setRevealing(false);
    }
  };

  const copyDirectory = async () => {
    const dir = deriveDirectory(result);
    if (!dir) return;
    const ok = await copyText(dir);
    if (ok) message.success("已复制分享包路径");
    else message.warning(`复制失败，可以手动复制：${dir}`);
  };

  return (
    <Modal
      title="离线分享包"
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(680px, 94vw)"
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      <Space orientation="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <Typography.Text strong>分享权限</Typography.Text>
          <Radio.Group
            style={{ marginTop: 8 }}
            value={permission}
            onChange={(event) => setPermission(event.target.value as SharePermission)}
          >
            {SHARE_PERMISSIONS.map((value) => (
              <Radio key={value} value={value}>
                {value === "read_only" ? "只读（不可回传评论）" : "可评论（附带评论回传文件）"}
              </Radio>
            ))}
          </Radio.Group>
        </div>

        <div>
          <Typography.Text strong>脱敏范围</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {REDACTION_FIELDS.map((field) => (
              <Checkbox
                key={field.key}
                checked={redactOptions[field.key]}
                onChange={(event) =>
                  setRedactOptions((prev) => ({ ...prev, [field.key]: event.target.checked }))
                }
              >
                {field.label}
              </Checkbox>
            ))}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            分享包始终基于脱敏后的内容生成，不含真实敏感信息。
          </Typography.Text>
        </div>

        <div>
          <Typography.Text strong>照片</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Checkbox
              checked={includePhoto}
              onChange={(event) => setIncludePhoto(event.target.checked)}
            >
              包含照片
            </Checkbox>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            分享包固定包含 HTML 与 PDF；取消勾选后这两个文件都不再绘制照片。
          </Typography.Text>
        </div>

        <Space wrap>
          <Button type="primary" loading={generating} onClick={() => void generate()}>
            生成分享包
          </Button>
          {/* R3：给"没有这个应用的人"的一份 zip（HTML + PDF + 说明）。 */}
          <Button
            icon={<DownloadOutlined />}
            loading={zipLoading}
            onClick={() => void downloadZip()}
          >
            下载离线包（zip）
          </Button>
        </Space>

        {!result && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            分享包含 HTML、PDF、脱敏快照与文件清单；生成后在这里显示实际体积。
          </Typography.Text>
        )}

        {result && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="标题">{result.title}</Descriptions.Item>
              <Descriptions.Item label="本地目录">{deriveDirectory(result)}</Descriptions.Item>
              <Descriptions.Item label="分享码">{result.share_token}</Descriptions.Item>
              <Descriptions.Item label="权限">
                <Tag color={result.permission === "comment" ? "blue" : "default"}>
                  {result.permission === "comment" ? "可评论" : "只读"}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="预计体积">
                {`约 ${formatBytes(totalBytes)}（${fileCount} 个文件）`}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <Typography.Text strong>使用说明</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0", fontSize: 12 }}>
                {
                  "把整个文件夹发给对方，对方用浏览器打开 resume.html 即可查看；HTML 与 PDF 由同一份版式生成。"
                }
                {result.permission === "comment"
                  ? " 如需评论，让对方填写 comments.md 后回传给你，你用「导入评论」导入。"
                  : ""}
              </Typography.Paragraph>
            </div>

            <Space wrap>
              <Button
                icon={<FolderOpenOutlined />}
                loading={revealing}
                onClick={() => void openDirectory()}
              >
                打开所在文件夹
              </Button>
              <Button icon={<CopyOutlined />} onClick={() => void copyDirectory()}>
                复制路径
              </Button>
            </Space>

            <div>
              <Typography.Text strong>文件清单</Typography.Text>
              <Space orientation="vertical" style={{ width: "100%", marginTop: 8 }} size={4}>
                {result.files.map((file) => (
                  <Space key={file.name} style={{ width: "100%" }} wrap>
                    <Button
                      type="link"
                      loading={downloading === file.name}
                      onClick={() => void downloadFile(result, file.name)}
                    >
                      {file.name}
                    </Button>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {file.format} · {file.size} B
                    </Typography.Text>
                  </Space>
                ))}
              </Space>
            </div>

            {result.permission === "comment" && (
              <div>
                <Typography.Text strong>评论回传</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  把收件人回传的评论内容粘贴进来导入（Markdown 或 JSON）。
                </Typography.Paragraph>
                <Space orientation="vertical" style={{ width: "100%" }} size="small">
                  <Radio.Group
                    value={commentFormat}
                    onChange={(event) => setCommentFormat(event.target.value)}
                  >
                    <Radio value="markdown">Markdown</Radio>
                    <Radio value="json">JSON</Radio>
                  </Radio.Group>
                  <Typography.Paragraph
                    style={{ whiteSpace: "pre-wrap", margin: 0 }}
                    type={comments ? undefined : "secondary"}
                  >
                    {comments || "（还没有评论）"}
                  </Typography.Paragraph>
                  <Space.Compact style={{ width: "100%" }}>
                    <Input.TextArea
                      aria-label="评论回传内容"
                      rows={4}
                      value={commentText}
                      placeholder="粘贴收件人回传的评论内容"
                      onChange={(event) => setCommentText(event.target.value)}
                    />
                    <Button
                      type="primary"
                      loading={importing}
                      onClick={() => void importComments()}
                    >
                      导入评论
                    </Button>
                  </Space.Compact>
                </Space>
              </div>
            )}

            {/* W18：可评论分享包额外附带对象锚定的回传批注（评审包 sidecar）。 */}
            {result.permission === "comment" ? (
              <div>
                <Typography.Text strong>{t("review.panel.title")}</Typography.Text>
                <ReviewAnnotationsPanel
                  sharePackageId={result.id}
                  api={reviewApi}
                  content={result.snapshot as unknown as ResumeContent}
                  onLocate={onLocateAnnotation}
                  showTitle={false}
                />
              </div>
            ) : null}

            {/* 删除收进「···」菜单：不再以红按钮裸露（全局约定）。 */}
            <RowActions
              more={[
                {
                  key: "delete",
                  label: "删除此分享包",
                  danger: true,
                  confirm: "删除此分享包？",
                  confirmBody: TRASH_RECOVERY_NOTE,
                  onClick: () => void removePackage(),
                },
              ]}
            />
          </>
        )}

        {generating && (
          <div style={{ textAlign: "center" }}>
            <Spin />
          </div>
        )}
      </Space>
    </Modal>
  );
}

// SPDX-License-Identifier: Apache-2.0
/**
 * 粘贴整段个人资料（或资料截图、简历文档）并结构化识别的弹窗。
 *
 * 两个阶段（项 13 / D23）：
 * 1. **输入**：粘贴 / 拖文件 / 截图 → 「识别并填入」；识别过程中主按钮变成
 *    「取消识别」（不是一直转圈的 loading 按钮——用户想反悔时得有个能点的东西）。
 * 2. **校对**：识别成功后**弹窗不关**，结果变成一张可编辑的清单；用户看过、改过、点
 *    「确认填入 N 项」才写进表单。识别是猜、改资料是写，两件事不该由一个按钮完成。
 *
 * `rows !== null` 即进入校对阶段——**不另立 step 状态**：两处状态（step + rows）能不一致，
 * 而它们本来描述的是同一件事。
 */

import { FileSearchOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Modal, Progress, Space, Spin, Typography } from "antd";
import type { StagedFile } from "../../hooks/useRecognitionFiles";
import { MaxLengthHint } from "../common/MaxLengthHint";
import RecognitionFileField from "../RecognitionFileField";
import RecognitionOutcome from "../RecognitionOutcome";
import RecognitionReviewList from "./RecognitionReviewList";
import type { RecognitionReviewRow } from "./RecognitionReviewList";
import type { RecognitionSource } from "../../types";

/** 上传阶段在整条进度里占的比例：0-15%，剩下的时间都在解析。 */
const UPLOAD_SHARE_PERCENT = 15;

/** 两种宿主：资料页（本轮）与网申资料（下一轮接链路，本轮只有文案）。 */
export type ProfileTextMode = "profile" | "webform";

const COPY: Record<ProfileTextMode, { title: string; placeholder: string; intro: string }> = {
  profile: {
    title: "粘贴个人资料并识别",
    placeholder:
      "例如：\n姓名：张三\n教育经历\n示例大学｜市场营销｜本科｜2022.09-2026.06\n项目经历\n校园招聘会策划｜负责人｜活动策划、渠道对接",
    intro:
      "可粘贴包含基本信息、教育经历、实习/工作经历、校园经历、项目经历、技能和获奖情况的整段文字，" +
      "也可以贴上这些内容的截图（在下面的输入框里按 Ctrl+V），或者上传简历文档（pdf/docx）。" +
      "文档文字在本机提取，不上传原文件；若已配置大模型，内容会发送到该模型进行" +
      "结构化识别。识别结果会先列成清单供你核对，确认后才填入表单。识别图片需要支持图片输入的多模态模型。",
  },
  webform: {
    title: "粘贴网申资料并识别",
    placeholder: "例如：\n政治面貌：中共党员\n是否有高中毕业证：是\n紧急联系人：张三 13800000000",
    intro:
      "把网申页面上的一屏栏目整段粘进来（也可以给截图或 PDF/Word），程序会按网申资料的字段目录" +
      "逐条归位。**目录外的新栏目会先列成待确认项**，由你逐条勾选后才新增——识别可以猜，" +
      "但你的资料不该被猜出来。",
  },
};

interface Props {
  open: boolean;
  text: string;
  warnings: string[];
  parsing: boolean;
  /**
   * 附件上传进度（0-100）；null 表示不在上传中。
   *
   * **100 表示字节已经发完**，服务端此时才开始解析、调模型——那一段耗时不可预估，
   * 所以到 100 就切成不确定态（转圈），不再显示百分比。
   */
  uploadPercent: number | null;
  recognizedText: string;
  /** 这次识别是 AI 还是本地规则；还没识别过时为 null。 */
  recognitionSource: RecognitionSource | null;
  files: StagedFile[];
  filesReading: boolean;
  /** 宿主形态：决定标题 / 说明 / 占位文案。默认资料页。 */
  mode?: ProfileTextMode;
  /** 非 null 即进入校对阶段（内容就是识别结果的行）。 */
  rows?: RecognitionReviewRow[] | null;
  onRowsChange?: (rows: RecognitionReviewRow[]) => void;
  /** 「确认填入」：把校对后的清单写进表单。 */
  onApply?: () => void;
  /** 「取消」：放弃这次识别结果，不写表单。 */
  onDiscard?: () => void;
  /** 识别中「取消识别」：中止请求。 */
  onCancelParse?: () => void;
  onTextChange: (value: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: number) => void;
  onPasteFiles: (event: React.ClipboardEvent<HTMLElement>) => void;
  onClose: () => void;
  onParse: () => void;
}

export default function ProfileTextModal({
  open,
  text,
  warnings,
  parsing,
  uploadPercent,
  recognizedText,
  recognitionSource,
  files,
  filesReading,
  mode = "profile",
  rows = null,
  onRowsChange,
  onApply,
  onDiscard,
  onCancelParse,
  onTextChange,
  onAddFiles,
  onRemoveFile,
  onPasteFiles,
  onClose,
  onParse,
}: Props) {
  const reviewing = rows !== null;
  const copy = COPY[mode];
  // 新字段只有在勾选后才计入"将写入 N 项"，所以这个数字就是用户眼前真正会发生的变化量。
  const confirmCount = rows ? rows.filter((row) => !row.isNew || row.selected).length : 0;
  // 关闭（X / ESC）在校对阶段等价于"放弃这次结果"，不能静默留下半份草稿。
  const handleCancel = reviewing ? (onDiscard ?? onClose) : onClose;

  return (
    <Modal
      title={copy.title}
      open={open}
      onCancel={handleCancel}
      destroyOnHidden
      width={760}
      footer={
        reviewing
          ? [
              <Button key="discard" onClick={onDiscard}>
                取消
              </Button>,
              <Button key="apply" type="primary" disabled={confirmCount === 0} onClick={onApply}>
                确认填入 {confirmCount} 项
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={onClose} disabled={parsing}>
                关闭
              </Button>,
              parsing ? (
                // 识别中不再给一个"转圈到结束"的 loading 按钮：用户唯一想做的事是取消。
                <Button key="cancel-parse" danger onClick={onCancelParse}>
                  取消识别
                </Button>
              ) : (
                <Button key="parse" type="primary" icon={<FileSearchOutlined />} onClick={onParse}>
                  识别并填入
                </Button>
              ),
            ]
      }
      styles={{ body: { paddingRight: 8 } }}
    >
      {reviewing ? (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={`识别到 ${rows.length} 项，核对无误后再填入（可原地修改）`}
            description="识别是自动推断，可能与原文有出入：逐条看过再确认，比事后再改回来省事。"
          />
          {warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              title={warnings.join("；")}
            />
          )}
          <RecognitionReviewList rows={rows} onChange={onRowsChange ?? (() => undefined)} />
          <RecognitionOutcome source={recognitionSource} text={recognizedText} />
        </>
      ) : (
        <>
          <Typography.Paragraph type="secondary">{copy.intro}</Typography.Paragraph>
          <Input.TextArea
            aria-label="个人资料文本"
            value={text}
            disabled={parsing}
            onPaste={onPasteFiles}
            onChange={(event) => onTextChange(event.target.value)}
            maxLength={100_000}
            placeholder={copy.placeholder}
            autoSize={{ minRows: 14, maxRows: 24 }}
          />
          <MaxLengthHint value={text} maxLength={100_000} />
          {/* 文件暂存区紧跟输入框下缘，补 12px 呼吸空隙，避免「添加截图或文档」按钮贴住边框。 */}
          <div style={{ marginTop: 12 }}>
            <RecognitionFileField
              files={files}
              reading={filesReading}
              disabled={parsing}
              onAddFiles={onAddFiles}
              onRemove={onRemoveFile}
            />
          </div>
          <RecognitionOutcome source={recognitionSource} text={recognizedText} />
          {uploadPercent !== null && uploadPercent < 100 && (
            // 上传阶段只占整个等待的一小段：真实字节映射到 0-15%，避免大文件一上传完
            // 进度条就画满、而用户还要再等十几秒解析。
            <Progress
              aria-label="附件上传进度"
              percent={Math.round((uploadPercent / 100) * UPLOAD_SHARE_PERCENT)}
              size="small"
              status="active"
              style={{ marginTop: 12 }}
            />
          )}
          {uploadPercent !== null && uploadPercent >= 100 && parsing && (
            // 解析阶段不显示百分比：服务端要抽文本、可能还要调模型，耗时不可预估。
            // 用不确定态 + 一句说明，比一个停在 15% 的假进度条诚实。
            <Space size={8} style={{ marginTop: 12 }}>
              <Spin size="small" />
              <Typography.Text type="secondary">正在解析资料…</Typography.Text>
            </Space>
          )}
          {warnings.length > 0 && (
            <Alert type="warning" showIcon style={{ marginTop: 12 }} title={warnings.join("；")} />
          )}
        </>
      )}
    </Modal>
  );
}

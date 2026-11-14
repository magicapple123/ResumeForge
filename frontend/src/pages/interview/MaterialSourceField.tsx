// SPDX-License-Identifier: Apache-2.0
/**
 * 面试材料来源（#41）：每侧材料都是**二选一**——从记录里挑一条，或直接导入一份文件。
 *
 * **两侧接受同一组格式**（问题 6）：图片（png / jpg / jpeg / webp）、PDF、TXT、
 * Word（.docx）、Markdown（.md / .markdown）。`kind` 只表示"放哪一侧"（界面左右栏），
 * 不再决定能传什么——解析路径由**文件类型**在后端分派：文本类走本机提取，
 * 图片与扫描件 PDF 走视觉识别。
 *
 * 组件只负责"选来源 + 上传 + 显示解析结果"，两个副作用都在这里收口：
 *
 * - **上传即解析**：文件一选就走 `extractInterviewMaterial`，返回的是已经提取好的文本；
 *   用户当场就能看到文件名与识别出多少字，而不是"点了开始面试之后才发现文件读不了"；
 * - **解析失败要说原因**：后端给的 detail 已经是面向用户的原因（例如截图没识别出文字），
 *   原样弹出即可，不在这里改写文案。
 *
 * 从记录选那一路的下拉框仍在 `SetupTab` 里（候选走远程搜索 hook），这里只提供模式开关。
 *
 * **岗位侧没有文件这一路**（Q3）：`allowFile={false}` 时整个 Radio.Group 与文件区都不渲染。
 * 岗位的正经入口是「去岗位广场从链接导入」，再给一个上传 JD 的入口就是同一件事两个入口；
 * 简历侧相反——用户手里常常就是一份现成的 PDF/Word，所以那边保留上传。
 */
import { DeleteOutlined, FileTextOutlined, PaperClipOutlined } from "@ant-design/icons";
import { Alert, App, Button, Radio, Space, Tag, Typography, Upload } from "antd";
import { useState } from "react";
import { extractInterviewMaterial } from "../../api/interview";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { InterviewMaterialExtract, InterviewMaterialKind } from "../../types";

/** 材料来源：从记录选，或导入文件。 */
export type MaterialSourceMode = "record" | "file";

/**
 * 两侧**共用**的接受列表（问题 6）。`accept` 属性与 `isAccepted` 必须读同一个常量：
 * 两处各写一份的话，浏览器文件选择框和上传前的检查会慢慢漂开（能选到、选完才报不支持）。
 */
const MATERIAL_ACCEPT = ".pdf,.txt,.md,.markdown,.docx,.png,.jpg,.jpeg,.webp";

/** Word 2003 的二进制格式：读不了就不假装能读，在选文件那一刻就说清怎么转。 */
const LEGACY_WORD_SUFFIX = ".doc";

/**
 * 上传前的客户端边界检查（与后端 MAX_MATERIAL_UPLOAD_BYTES 同一个数）。
 *
 * 后端本来就会拒，但等文件传完一圈再报错是最差的一种反馈：10 MB 的 PDF 传上去、
 * 解析一遍，最后才说"太大"。空文件与格式不支持同理——在选完文件的那一秒就能说清。
 */
const MAX_MATERIAL_BYTES = 10 * 1024 * 1024;

/** 扩展名（小写、带点）是否被接受；没有扩展名的文件一律按不支持处理。 */
function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot).toLowerCase();
}

function isAccepted(name: string): boolean {
  return MATERIAL_ACCEPT.split(",").includes(fileExtension(name));
}

export function MaterialSourceField({
  kind,
  mode,
  material,
  disabled = false,
  allowFile = true,
  onModeChange,
  onMaterialChange,
}: {
  kind: InterviewMaterialKind;
  mode: MaterialSourceMode;
  /** 已解析好的材料；`null` 表示还没选文件。 */
  material: InterviewMaterialExtract | null;
  /** 正在开场：上传与切换都停掉，避免和提交抢状态。 */
  disabled?: boolean;
  /**
   * 是否允许「导入文件」这一路（Q3）：岗位侧只保留「从记录选」——真实岗位几乎都是从岗位广场
   * 按链接导入的，再给一个上传 JD 的入口只会让同一件事有两个入口。`false` 时**整个
   * Radio.Group 不渲染**，也不再有文件区，只留记录侧的下拉。
   */
  allowFile?: boolean;
  onModeChange: (mode: MaterialSourceMode) => void;
  onMaterialChange: (material: InterviewMaterialExtract | null) => void;
}) {
  // 模块级 t()：必须订阅语言变化，否则切语言后这段文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [parsing, setParsing] = useState(false);
  const busy = parsing || disabled;

  /** 选好文件就立刻上传解析：结果直接是一段可进提示词的文本。 */
  const parse = async (file: File) => {
    // 先做不需要联网就能判的边界检查，别让用户等一次上传 + 解析才知道文件不能用。
    if (file.size === 0) {
      onMaterialChange(null);
      message.error(t("interviewPage.setup.material.emptyFile"));
      return;
    }
    if (file.size > MAX_MATERIAL_BYTES) {
      onMaterialChange(null);
      message.error(t("interviewPage.setup.material.tooLarge"));
      return;
    }
    if (fileExtension(file.name) === LEGACY_WORD_SUFFIX) {
      // .doc 是二进制格式，服务端也读不了；在选文件这一秒就说清怎么转（不等一次上传）。
      onMaterialChange(null);
      message.error(t("interviewPage.setup.material.legacyDoc"));
      return;
    }
    if (!isAccepted(file.name)) {
      onMaterialChange(null);
      message.error(t("interviewPage.setup.material.unsupported"));
      return;
    }
    setParsing(true);
    onMaterialChange(null);
    try {
      const extracted = await extractInterviewMaterial(kind, file);
      onMaterialChange(extracted);
      // 警告（如"内容较长，只识别了前一部分"）不再只靠一闪而过的 Toast：材料块里
      // 常驻一条警告条，用户回头还能看到这份材料哪里打了折扣。
      if (extracted.warnings.length > 0) message.warning(extracted.warnings[0]);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("interviewPage.setup.material.parseFailed"),
      );
    } finally {
      setParsing(false);
    }
  };

  // 文案按**实际解析路径**选（问题 6），不再按左右侧：两侧都能传图片与文本类文件，
  // "从截图识别出 N 字"对一份 Word 是假话，反之亦然。
  const sizeKey: MessageKey =
    material?.parser === "vision"
      ? "interviewPage.setup.material.recognized"
      : "interviewPage.setup.material.parsed";

  return (
    <div className="interview-material-source">
      {/* 次级开关：`outline` 而不是 `solid`——深蓝实心留给页面唯一的主操作「开始面试」，
          否则页面上会出现两个同等权重的焦点。`size="small"` 也刻意不追平 32px 的 Select：
          靠间距分层，不靠高度对齐。岗位侧（`allowFile={false}`）整块不渲染。 */}
      {allowFile && (
        <Radio.Group
          size="small"
          optionType="button"
          buttonStyle="outline"
          disabled={disabled}
          value={mode}
          onChange={(event) => onModeChange(event.target.value as MaterialSourceMode)}
          options={[
            { value: "record", label: t("interviewPage.setup.material.fromRecord") },
            { value: "file", label: t("interviewPage.setup.material.fromFile") },
          ]}
        />
      )}
      {allowFile && mode === "file" ? (
        <Space size={6} wrap className="interview-material-file">
          <Upload
            accept={MATERIAL_ACCEPT}
            showUploadList={false}
            disabled={busy}
            beforeUpload={(file) => {
              void parse(file as File);
              // 与仓库其它上传一致：本地读完自己提交，不走 antd 的上传通道。
              return Upload.LIST_IGNORE;
            }}
          >
            <Button size="small" icon={<PaperClipOutlined />} loading={parsing} disabled={disabled}>
              {material
                ? t("interviewPage.setup.material.repickFile")
                : t("interviewPage.setup.material.pickFile")}
            </Button>
          </Upload>
          {material ? (
            <>
              <Tag color="green" icon={<FileTextOutlined />}>
                {material.name}
              </Tag>
              <Typography.Text type="secondary">
                {t(sizeKey, { chars: material.text.length })}
              </Typography.Text>
              <Button
                type="text"
                size="small"
                danger
                disabled={busy}
                aria-label={t("interviewPage.setup.material.clear")}
                icon={<DeleteOutlined />}
                onClick={() => onMaterialChange(null)}
              />
            </>
          ) : parsing ? (
            <Typography.Text type="secondary">
              {t("interviewPage.setup.material.parsing")}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              {t("interviewPage.setup.material.fileHint")}
            </Typography.Text>
          )}
        </Space>
      ) : null}
      {/* 解析成功但带警告：常驻在材料块里（而不是只闪一条 Toast）。 */}
      {allowFile && mode === "file" && material && material.warnings.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          className="interview-material-warning"
          title={t("interviewPage.setup.material.warningTitle")}
          description={
            <ul>
              {material.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          }
        />
      ) : null}
    </div>
  );
}

export default MaterialSourceField;

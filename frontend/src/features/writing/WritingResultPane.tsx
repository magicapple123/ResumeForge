// SPDX-License-Identifier: Apache-2.0
/**
 * 单条结果的展示区：版本条（v1…v5）+ 可编辑结果 + 「再改一版」快捷微调。
 *
 * 回填读的是**当前选中那一版、且已经算上用户手动改动**的文本：版本条切到 v1 就回填 v1，
 * 直接在结果框里改字则回填改后的字。
 */
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { Button, Input, Space, Tag, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import WritingRefineChips from "./WritingRefineChips";
import type { WritingVersions } from "./useWritingVersions";

interface Props {
  versions: WritingVersions;
  /** 有可写目标时回填；缺省 = 没有目标，结果区退回「复制」。 */
  onApply?: (text: string) => void;
  onCopy: (text: string) => void;
  onRefine: (instruction: string) => Promise<boolean>;
  /** 迭代请求在飞。 */
  refining: boolean;
}

export default function WritingResultPane({
  versions,
  onApply,
  onCopy,
  onRefine,
  refining,
}: Props) {
  useLocale();
  const current = versions.current;
  // 版本被清空（切到话术版）时整块消失：没有结果就没有可回填的东西。
  if (!current) return null;
  const act = onApply ? () => onApply(current.text) : () => onCopy(current.text);

  return (
    <div className="resume-writing-result">
      <div className="resume-writing-result-head">
        <Space size={6} wrap className="resume-writing-versions">
          <Typography.Text strong>{t("writing.result.label")}</Typography.Text>
          {/* 只有一版时版本条没有意义（点了也不会变），两版起才出现。 */}
          {versions.versions.length > 1 && (
            <Space size={2} role="group" aria-label={t("writing.version.ariaLabel")}>
              {versions.versions.map((_, index) => (
                <Button
                  key={index}
                  size="small"
                  type={index === versions.active ? "primary" : "text"}
                  aria-pressed={index === versions.active}
                  onClick={() => versions.select(index)}
                >
                  {t("writing.version.label", { index: index + 1 })}
                </Button>
              ))}
            </Space>
          )}
        </Space>
        <Space size={4}>
          {current.edited && <Tag color="gold">{t("writing.result.edited")}</Tag>}
          <Button
            size="small"
            type="link"
            icon={onApply ? <CheckOutlined aria-hidden /> : <CopyOutlined aria-hidden />}
            onClick={act}
          >
            {onApply ? t("writing.action.apply") : t("writing.action.copy")}
          </Button>
        </Space>
      </div>
      <Input.TextArea
        className="resume-writing-result-input"
        aria-label={t("writing.result.ariaLabel")}
        value={current.text}
        autoSize={{ minRows: 3, maxRows: 12 }}
        // 改动直接写进版本栈：切走再切回来，改过的字还在（见 useWritingVersions 文件头）。
        onChange={(event) => versions.edit(event.target.value)}
      />
      <WritingRefineChips loading={refining} onRefine={onRefine} />
    </div>
  );
}

/**
 * 话术生成的三块结果块（STAR / 简历 / 面试口述）。
 *
 * 它没有版本与迭代：一次返回三份不同用途的稿子，用户要的是"各取一次"，
 * 不是在同一份上反复打磨。
 */
export function WritingResultBlock({
  label,
  onApply,
  onCopy,
  children,
}: {
  label: string;
  /** 有可写目标时优先回填；没有才退回复制。 */
  onApply?: () => void;
  onCopy: () => void;
  children: React.ReactNode;
}) {
  useLocale();
  const run = onApply ?? onCopy;
  return (
    <div className="resume-writing-result">
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Text strong>{label}</Typography.Text>
        <Button
          size="small"
          type="link"
          icon={onApply ? <CheckOutlined aria-hidden /> : <CopyOutlined aria-hidden />}
          onClick={run}
        >
          {onApply ? t("writing.action.apply") : t("writing.action.copy")}
        </Button>
      </Space>
      {children}
    </div>
  );
}

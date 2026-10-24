// SPDX-License-Identifier: Apache-2.0
/**
 * 「这些资料内容没有写进这份简历」的中性提示块（#3 / #5）。
 *
 * **为什么单独成文件**：宿主 `ResumeDetailPreview` 贴着 500 行预算，而这一块是**派生数据
 * 的纯展示**——它只读 `coverage_notes` 与那几条从 `warnings` 里拆出来的旧版警告，两个动作
 * 都是"把用户带到能处理它的地方"（修订弹窗 / 手动调整）。没有任何自己的状态。
 *
 * 与「疑似虚构」分开呈现是刻意的：岗位导向筛选把与岗位关键词交集不足的内容挡在生成之外，
 * 这是**正常结果**，资料本身一条都没丢；把它和虚构混成一面红色的墙，用户会以为数据坏了。
 *
 * 搬运时行为一字未改：文案、顺序、每条分区下面的「AI 补上这段」，以及底部的
 * 「打开手动调整」都留在原位。
 */
import { Alert, Button, Space, Typography } from "antd";
import type { ResumeCoverageNote } from "../../types";

interface Props {
  /** 结构化的分区级清单（新生成的记录才有）。 */
  notes: ResumeCoverageNote[];
  /** 旧记录把未收录警告混在 `warnings` 文本里：按特征句拆出来的那几条。 */
  legacyWarnings: string[];
  /** 「AI 补上这段」：把拼好的指令交给宿主的修订弹窗。 */
  onRevise: (instructions: string) => void;
  /** 「打开手动调整」：宿主负责关掉目标定位、打开编辑器。 */
  onOpenEditor: () => void;
}

export default function ResumeCoverageNotes({
  notes,
  legacyWarnings,
  onRevise,
  onOpenEditor,
}: Props) {
  // 两类数据都空时整块不渲染：空壳会在每份简历的弹窗里多出一条什么都没有的提示条。
  if (notes.length === 0 && legacyWarnings.length === 0) return null;

  /** 一句话把这条分区清单变成"只补这些、其余不动"的修订指令。 */
  const reviseInstructions = (note: ResumeCoverageNote): string =>
    `请把资料中的以下内容补进这份简历的${note.section_label}（只新增这些内容，其余部分保持不变）：` +
    note.names.map((name) => `「${name}」`).join("、") +
    "。补充时使用这些条目在个人资料中的原文事实，不要虚构细节。";

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      title="这些资料内容没有写进这份简历"
      description={
        <div style={{ display: "grid", gap: 10 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            这是岗位导向筛选的正常结果：与岗位关键词交集不足的内容不会进入生成，资料本身没有任何丢失。
          </Typography.Text>
          {notes.map((note) => (
            <div key={note.section}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                {note.section_label}（{note.total} 条）：
              </Typography.Text>
              <Typography.Text style={{ fontSize: 13 }}>
                {note.names.map((name) => `「${name}」`).join("、")}
              </Typography.Text>
              <Space size={8} style={{ marginTop: 6 }} wrap>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => onRevise(reviseInstructions(note))}
                >
                  AI 补上这段
                </Button>
              </Space>
            </div>
          ))}
          {legacyWarnings.map((warning) => (
            <Typography.Paragraph key={warning} style={{ margin: 0, fontSize: 13 }}>
              {warning}
            </Typography.Paragraph>
          ))}
          {notes.length > 0 && (
            <Space size={8} wrap>
              <Button size="small" onClick={onOpenEditor}>
                打开手动调整
              </Button>
            </Space>
          )}
        </div>
      }
    />
  );
}

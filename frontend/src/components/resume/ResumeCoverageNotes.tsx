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
import { useI18n } from "../../i18n/i18nContext";
import { RESUME_CATALOG_SECTION_LABEL_KEYS } from "../../i18n/enum/resumeCatalog";
import type { ResumeCoverageNote } from "../../types";

/**
 * `coverage_notes[].section` 是**资料分区键**（后端 `resume_coverage._SECTION_MAP`）：
 * 其中三个分区在资料侧是复数（`experiences` / `educations` / `campus_experiences`），
 * 与简历分区键不同名。显示前先归一到简历分区键，再查语言包（其余分区同名，不需要别名）。
 * 不归一的话，这三个分区在英文界面仍会回退后端中文。
 */
const PROFILE_SECTION_KEY_ALIASES: Record<string, string> = {
  experiences: "experience",
  educations: "education",
  campus_experiences: "campus_experience",
};

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
  const { t } = useI18n();
  // 两类数据都空时整块不渲染：空壳会在每份简历的弹窗里多出一条什么都没有的提示条。
  if (notes.length === 0 && legacyWarnings.length === 0) return null;

  /** 一句话把这条分区清单变成"只补这些、其余不动"的修订指令。 */
  const reviseInstructions = (note: ResumeCoverageNote): string =>
    // i18n-ok: 喂给模型的修订指令（作为 prompt 保持中文，初值会带进修订弹窗）
    `请把资料中的以下内容补进这份简历的${note.section_label}（只新增这些内容，其余部分保持不变）：` +
    note.names.map((name) => `「${name}」`).join("、") + // i18n-ok: 同上，模型 prompt 里的中文引号与顿号
    "。补充时使用这些条目在个人资料中的原文事实，不要虚构细节。"; // i18n-ok: 同上，模型 prompt

  /** 把多个资料名排成一行：引号与分隔符随界面语言（提示块正文用）。 */
  const formatNames = (names: string[]): string =>
    names
      .map((name) => t("resume.coverage.item", { name }))
      .join(t("resume.coverage.itemSeparator"));

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      title={t("resume.coverage.title")}
      description={
        <div style={{ display: "grid", gap: 10 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("resume.coverage.intro")}
          </Typography.Text>
          {notes.map((note) => {
            // 分区名走语言包（按稳定的 `section` 键，先归一对资料侧的复数键），
            // 后端下发的原文只作未知分区的回退；喂给模型的修订指令仍用后端原文，不本地化。
            const section = PROFILE_SECTION_KEY_ALIASES[note.section] ?? note.section;
            const sectionKey = RESUME_CATALOG_SECTION_LABEL_KEYS[section];
            return (
              <div key={note.section}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  {t("resume.coverage.sectionCount", {
                    label: sectionKey ? t(sectionKey) : note.section_label,
                    count: note.total,
                  })}
                </Typography.Text>
                <Typography.Text style={{ fontSize: 13 }}>
                  {formatNames(note.names)}
                </Typography.Text>
                <Space size={8} style={{ marginTop: 6 }} wrap>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    onClick={() => onRevise(reviseInstructions(note))}
                  >
                    {t("resume.coverage.revise")}
                  </Button>
                </Space>
              </div>
            );
          })}
          {legacyWarnings.map((warning) => (
            <Typography.Paragraph key={warning} style={{ margin: 0, fontSize: 13 }}>
              {warning}
            </Typography.Paragraph>
          ))}
          {notes.length > 0 && (
            <Space size={8} wrap>
              <Button size="small" onClick={onOpenEditor}>
                {t("resume.coverage.openEditor")}
              </Button>
            </Space>
          )}
        </div>
      }
    />
  );
}

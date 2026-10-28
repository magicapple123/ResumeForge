// SPDX-License-Identifier: Apache-2.0
/**
 * 填写规则与判定表（R-71）：§3.4 的十行与总则必须在资料页可见、不依赖外部链接。
 *
 * 只读弹层（footer=null，× / Esc 关闭）；表格 10 行由 message 数据解析（数据在
 * zh-CN.profileLibrary.ts，组件内零中文字面量）。
 *
 * 需求 7：表格前先加一段**术语说明**（方案 / 板块 / 字段 + 三者层级）。原因：判定表说的是
 * "这段素材该填哪个板块"，而用户并不知道"板块"是什么、和设置页里那些开关是什么关系；
 * 先给词汇表，再看表格，才知道每个设置管的是哪一层。对外统一口径是
 * 「方案 / 板块 / 条目 / 字段」（旧名「组 / 大字段 / 小字段」不再出现在用户可见文案里）。
 */
import { Modal, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 判定表行：文案里用 | 分隔「素材特征」与「该填哪里」。 */
const RULE_KEYS = [
  "profileLibrary.guide.row.work",
  "profileLibrary.guide.row.campus",
  "profileLibrary.guide.row.volunteer",
  "profileLibrary.guide.row.paper",
  "profileLibrary.guide.row.research",
  "profileLibrary.guide.row.project",
  "profileLibrary.guide.row.award",
  "profileLibrary.guide.row.credential",
  "profileLibrary.guide.row.language",
  "profileLibrary.guide.row.patent",
] as const;

/**
 * 术语说明：三条词义 + 一条层级。
 *
 * 按「方案 › 板块 › 字段」的顺序排：这个顺序本身就是层级，读一遍就知道谁包含谁。
 */
const TERM_KEYS = [
  "profileLibrary.guide.terms.plan",
  "profileLibrary.guide.terms.section",
  "profileLibrary.guide.terms.field",
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ProfilePlacementGuide({ open, onClose }: Props) {
  useLocale();
  const rows = RULE_KEYS.map((key) => {
    const [feature, target] = t(key).split("|");
    return { feature, target };
  });
  return (
    <Modal
      title={t("profileLibrary.guide.title")}
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
    >
      <Typography.Paragraph type="secondary">
        {t("profileLibrary.guide.subtitle")}
      </Typography.Paragraph>
      <div className="profile-placement-guide-terms" data-testid="placement-guide-terms">
        <Typography.Paragraph strong style={{ marginBottom: 4 }}>
          {t("profileLibrary.guide.terms.title")}
        </Typography.Paragraph>
        <ul className="profile-placement-guide-term-list">
          {TERM_KEYS.map((key) => (
            <li key={key} data-testid="placement-guide-term">
              {t(key)}
            </li>
          ))}
        </ul>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("profileLibrary.guide.terms.hierarchy")}
        </Typography.Paragraph>
      </div>
      <table className="profile-placement-guide-table" data-testid="placement-guide">
        <thead>
          <tr>
            <th>{t("profileLibrary.guide.ruleCol")}</th>
            <th>{t("profileLibrary.guide.targetCol")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.feature} data-testid="placement-guide-row">
              <td>{row.feature}</td>
              <td>{row.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Typography.Paragraph strong style={{ marginTop: 16 }}>
        {t("profileLibrary.guide.total")}
      </Typography.Paragraph>
    </Modal>
  );
}

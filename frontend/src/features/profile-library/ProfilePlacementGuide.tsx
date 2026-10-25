// SPDX-License-Identifier: Apache-2.0
/**
 * 填写规则与判定表（R-71）：§3.4 的十行与总则必须在资料页可见、不依赖外部链接。
 *
 * 只读弹层（footer=null，× / Esc 关闭）；表格 10 行由 message 数据解析（数据在
 * zh-CN.profileLibrary.ts，组件内零中文字面量）。
 */
import { Modal, Typography } from "antd";
import { t } from "../../i18n";

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

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ProfilePlacementGuide({ open, onClose }: Props) {
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
      <Typography.Title level={5}>{t("profileLibrary.guide.trainingTitle")}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {t("profileLibrary.guide.trainingBody")}
      </Typography.Paragraph>
    </Modal>
  );
}

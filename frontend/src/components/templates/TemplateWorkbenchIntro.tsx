// SPDX-License-Identifier: Apache-2.0
/**
 * 工作台顶部说明卡：解释「版式」是什么、怎么用。
 *
 * 2026-11 改写：自制模板下线后，原来那句"从下面挑一个内置模板，点「复制为新模板」开始编辑"
 * 指向的按钮已经不存在了——指南类文案提到一个点不到的东西，比不写更糟。现在只讲版式，
 * "内置模板随时可换"只作为对模板的描述保留（模板仍在生成与预览里切换）。
 */
import { Card, Typography } from "antd";
import { t } from "../../i18n";

export default function TemplateWorkbenchIntro() {
  return (
    <Card size="small" className="settings-card">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("layout.intro.title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {t("layout.intro.body")}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t("layout.intro.howto")}
      </Typography.Paragraph>
    </Card>
  );
}

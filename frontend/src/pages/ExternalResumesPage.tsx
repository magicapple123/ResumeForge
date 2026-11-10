// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心 · 外部简历（独立页，清单 §1）。
 *
 * 为什么从简历中心拆出来：外部简历是**只读快照**（不能编辑、没有制作台、操作集完全不同），
 * 常驻挂在简历表格上方会把真正的主角挤出首屏，也让人误以为这是"第二套简历列表"。
 *
 * 版式约束（清单 §1.9，用户明确要求）：
 * - 页面标题**不放进 `Card title`**：antd v6 的 `.ant-card-head` 纵向内边距为 0，标题里
 *   放"标题 + 副标题"两行时文字会贴着卡片上边框（实测 1px）。这里用页面级标题行，
 *   顶格问题从结构上不存在。
 * - 页面根节点不包 `<Card>`：`.app-content` 已有 `--rf-content-pad`，再套一层会出现
 *   "页内卡片贴页面边缘"的第二种顶格。
 */
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Flex, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import ExternalResumePanel from "./resumes/ExternalResumePanel";

export default function ExternalResumesPage() {
  useLocale();
  const navigate = useNavigate();
  /**
   * 返回简历中心：优先退历史（保留来时的筛选/页码），没有历史（直接刷新或深链打开）时
   * 落到 `/resumes`。`history.state.idx` 是 data router 记录的栈深度，刷新后仍有效。
   */
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  const goBack = () => (canGoBack ? navigate(-1) : navigate("/resumes"));

  return (
    <Flex vertical gap={12}>
      <Flex vertical gap={4}>
        {/* 纵向 flex 里按钮默认 stretch：不钉住左缘时整颗按钮横跨一行、文字居中，
            看起来像"标题上方飘着一行居中的链接"。 */}
        <Button
          type="link"
          size="small"
          style={{ alignSelf: "flex-start", paddingInline: 0 }}
          icon={<ArrowLeftOutlined aria-hidden />}
          onClick={goBack}
        >
          {t("resumesPage.external.back")}
        </Button>
        <Flex gap={8} align="center" wrap>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("resumesPage.external.title")}
          </Typography.Title>
          <Tag>{t("resumesPage.external.tag")}</Tag>
        </Flex>
        <Typography.Text type="secondary">{t("resumesPage.external.subtitle")}</Typography.Text>
      </Flex>
      <ExternalResumePanel variant="bare" />
    </Flex>
  );
}

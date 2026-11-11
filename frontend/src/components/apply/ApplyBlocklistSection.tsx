// SPDX-License-Identifier: Apache-2.0
/**
 * 屏蔽清单（#14E）：两个 textarea，一行一项，保存走 `PUT /apply/blocklist`。
 *
 * 为什么是 textarea 而不是可增删的列表控件：屏蔽清单是"一次想清楚、之后偶尔改"的静态配置，
 * 复制粘贴一整列公司名是最常见的输入方式。后端负责匹配规则（公司按 `company_key` 归并、
 * 关键词按包含匹配且要求 ≥2 字），前端只做"按行拆分 + 去空白 + 去空行"。
 *
 * 独立成组件（而不是塞进投递设置主表单）：主表单提交的是 `/apply/config`，屏蔽清单是另一个
 * 端点，混在一个保存按钮里会让"保存设置"悄悄写两个接口。
 */
import { Alert, App, Button, Input, Space, Typography } from "antd";
import { useState } from "react";
import { getApplyBlocklist, saveApplyBlocklist } from "../../api/applyExtras";
import { useApi } from "../../hooks/useApi";
import LoadingBlock from "../common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyBlocklist } from "../../types";

/** 一行一项 → 数组：去掉首尾空白与空行，保留用户写的顺序。 */
export function splitBlocklistText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function ApplyBlocklistSection() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const { data, loading, error } = useApi<ApplyBlocklist>(getApplyBlocklist, []);
  const [companies, setCompanies] = useState("");
  const [keywords, setKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  // 渲染期镜像同步（与投递记录搜索框同模式）：接口回包只灌一次，之后由用户编辑。
  const [source, setSource] = useState<ApplyBlocklist | null>(null);
  if (data && data !== source) {
    setSource(data);
    setCompanies(data.companies.join(String.fromCharCode(10)));
    setKeywords(data.keywords.join(String.fromCharCode(10)));
  }

  const save = async () => {
    setSaving(true);
    try {
      await saveApplyBlocklist({
        companies: splitBlocklistText(companies),
        keywords: splitBlocklistText(keywords),
      });
      message.success(t("applySettings.blocklist.saved"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applySettings.blocklist.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <LoadingBlock />;

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t("applySettings.blocklist.intro")}
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon title={t("applySettings.blocklist.loadFailed")} />}
      <Typography.Text strong>{t("applySettings.blocklist.companies")}</Typography.Text>
      <Input.TextArea
        rows={4}
        value={companies}
        onChange={(event) => setCompanies(event.target.value)}
        aria-label={t("applySettings.blocklist.companies")}
      />
      <Typography.Text type="secondary">
        {t("applySettings.blocklist.companiesHint")}
      </Typography.Text>
      <Typography.Text strong>{t("applySettings.blocklist.keywords")}</Typography.Text>
      <Input.TextArea
        rows={4}
        value={keywords}
        onChange={(event) => setKeywords(event.target.value)}
        aria-label={t("applySettings.blocklist.keywords")}
      />
      <Typography.Text type="secondary">
        {t("applySettings.blocklist.keywordsHint")}
      </Typography.Text>
      <div>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          {t("applySettings.blocklist.save")}
        </Button>
      </div>
    </Space>
  );
}

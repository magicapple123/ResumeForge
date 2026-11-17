// SPDX-License-Identifier: Apache-2.0
/**
 * 屏蔽清单（#14E）：默认是「标签 + 回车添加」，需要整列粘贴时切回两个 textarea。
 *
 * 为什么默认标签而不是 textarea：这份清单是"一次想清楚、之后偶尔改"的静态配置，
 * 但**最常发生的动作是核对**——用户想知道"我到底屏蔽了哪些词"。textarea 里一行一项
 * 看不出边界，标签模式一屏就数得清，删除也不用先选中整行。
 *
 * 为什么保留批量编辑：从表格 / 聊天记录里复制一整列公司名是最快的录入方式，逐个回车
 * 反而更慢。两个模式**共用同一份状态**，来回切换不丢已输入内容。
 *
 * 无效关键词（太短 / 太宽泛）由后端用与匹配**同一份规则**判出（`inactive_keywords`），
 * 这里只负责渲染成灰标签 + 「太宽泛，不会生效」——前端不复制停用词表，否则两边迟早漂移。
 */
import { CloseOutlined } from "@ant-design/icons";
import { Alert, App, Button, Input, Space, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { getApplyBlocklist, saveApplyBlocklist } from "../../api/applyExtras";
import { useApi } from "../../hooks/useApi";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyBlocklist } from "../../types";
import "./applySettingsSections.css";

const NEWLINE = String.fromCharCode(10);

/** 一行一项 → 数组：去掉首尾空白与空行，保留用户写的顺序。 */
export function splitBlocklistText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 把还没回车提交的草稿并进列表；空串与重复项原样返回（切模式时不该凭空多出一项）。 */
function appendDraft(list: string[], draft: string): string[] {
  const value = draft.trim();
  if (!value || list.includes(value)) return list;
  return [...list, value];
}

export default function ApplyBlocklistSection() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const { data, loading, error } = useApi<ApplyBlocklist>(getApplyBlocklist, []);
  const [companies, setCompanies] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [inactive, setInactive] = useState<string[]>([]);
  // 批量编辑模式的正文：与上面的列表同一份内容，切换时互相回填。
  const [companiesText, setCompaniesText] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [companyDraft, setCompanyDraft] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [mode, setMode] = useState<"tags" | "bulk">("tags");
  const [saving, setSaving] = useState(false);
  // 渲染期镜像同步（与投递记录搜索框同模式）：接口回包只灌一次，之后由用户编辑。
  const [source, setSource] = useState<ApplyBlocklist | null>(null);
  if (data && data !== source) {
    setSource(data);
    setCompanies(data.companies);
    setKeywords(data.keywords);
    setInactive(data.inactive_keywords);
    setCompaniesText(data.companies.join(NEWLINE));
    setKeywordsText(data.keywords.join(NEWLINE));
  }

  const addCompany = () => {
    const next = appendDraft(companies, companyDraft);
    if (next !== companies) {
      setCompanies(next);
      setCompaniesText(next.join(NEWLINE));
    }
    setCompanyDraft("");
  };

  const addKeyword = () => {
    const next = appendDraft(keywords, keywordDraft);
    if (next !== keywords) {
      setKeywords(next);
      setKeywordsText(next.join(NEWLINE));
    }
    setKeywordDraft("");
  };

  const removeCompany = (value: string) => {
    const next = companies.filter((item) => item !== value);
    setCompanies(next);
    setCompaniesText(next.join(NEWLINE));
  };

  const removeKeyword = (value: string) => {
    const next = keywords.filter((item) => item !== value);
    setKeywords(next);
    setKeywordsText(next.join(NEWLINE));
  };

  /** 两个模式来回切换：把"当前模式里最完整的那份"写回另一份，已输入的内容不丢。 */
  const toggleMode = () => {
    if (mode === "tags") {
      // 草稿也算"已输入"：输入到一半切走再切回来，不该要求重打。
      const nextCompanies = appendDraft(companies, companyDraft);
      const nextKeywords = appendDraft(keywords, keywordDraft);
      setCompanies(nextCompanies);
      setKeywords(nextKeywords);
      setCompaniesText(nextCompanies.join(NEWLINE));
      setKeywordsText(nextKeywords.join(NEWLINE));
      setCompanyDraft("");
      setKeywordDraft("");
      setMode("bulk");
      return;
    }
    const nextCompanies = splitBlocklistText(companiesText);
    const nextKeywords = splitBlocklistText(keywordsText);
    setCompanies(nextCompanies);
    setKeywords(nextKeywords);
    setCompaniesText(nextCompanies.join(NEWLINE));
    setKeywordsText(nextKeywords.join(NEWLINE));
    // 失效判定是后端算的：本地只保留"还在清单里"的那些，剩下的等保存回包刷新。
    setInactive((current) => current.filter((word) => nextKeywords.includes(word)));
    setMode("tags");
  };

  const save = async () => {
    setSaving(true);
    const payload = {
      companies: mode === "bulk" ? splitBlocklistText(companiesText) : companies,
      keywords: mode === "bulk" ? splitBlocklistText(keywordsText) : keywords,
    };
    try {
      const saved = await saveApplyBlocklist(payload);
      setCompanies(saved.companies);
      setKeywords(saved.keywords);
      setInactive(saved.inactive_keywords);
      setCompaniesText(saved.companies.join(NEWLINE));
      setKeywordsText(saved.keywords.join(NEWLINE));
      message.success(t("applySettings.blocklist.saved"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applySettings.blocklist.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <LoadingBlock />;

  const closeIcon = <CloseOutlined aria-label={t("applySettings.blocklist.remove")} />;

  const renderTags = (items: string[], onRemove: (value: string) => void, dead: string[]) => (
    <div className="apply-blocklist-tags">
      {items.map((item) => {
        const tag = (
          <Tag
            key={item}
            // 只有关键词可能失效；公司名永远按全名精确匹配。
            color={dead.includes(item) ? "default" : undefined}
            closable
            closeIcon={closeIcon}
            onClose={() => onRemove(item)}
          >
            {item}
          </Tag>
        );
        if (!dead.includes(item)) return tag;
        return (
          <Tooltip key={item} title={t("applySettings.blocklist.inactive")}>
            {tag}
          </Tooltip>
        );
      })}
    </div>
  );

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      <div className="apply-blocklist-head">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("applySettings.blocklist.intro")}
        </Typography.Paragraph>
        <Button type="link" size="small" onClick={toggleMode}>
          {mode === "bulk"
            ? t("applySettings.blocklist.backToTags")
            : t("applySettings.blocklist.batchEdit")}
        </Button>
      </div>
      {error && <Alert type="error" showIcon title={t("applySettings.blocklist.loadFailed")} />}

      <div className="apply-blocklist-group">
        <Typography.Text strong>{t("applySettings.blocklist.companies")}</Typography.Text>
        {mode === "bulk" ? (
          <Input.TextArea
            rows={4}
            value={companiesText}
            onChange={(event) => setCompaniesText(event.target.value)}
            aria-label={t("applySettings.blocklist.companies")}
          />
        ) : (
          <>
            {renderTags(companies, removeCompany, [])}
            <Input
              className="apply-blocklist-add"
              value={companyDraft}
              onChange={(event) => setCompanyDraft(event.target.value)}
              onPressEnter={addCompany}
              aria-label={t("applySettings.blocklist.companyAddAria")}
              placeholder={t("applySettings.blocklist.companyAddPlaceholder")}
            />
          </>
        )}
        <Typography.Text type="secondary">
          {t("applySettings.blocklist.companiesHint")}
        </Typography.Text>
      </div>

      <div className="apply-blocklist-group">
        <Typography.Text strong>{t("applySettings.blocklist.keywords")}</Typography.Text>
        {mode === "bulk" ? (
          <Input.TextArea
            rows={4}
            value={keywordsText}
            onChange={(event) => setKeywordsText(event.target.value)}
            aria-label={t("applySettings.blocklist.keywords")}
          />
        ) : (
          <>
            {renderTags(keywords, removeKeyword, inactive)}
            <Input
              className="apply-blocklist-add"
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              onPressEnter={addKeyword}
              aria-label={t("applySettings.blocklist.keywordAddAria")}
              placeholder={t("applySettings.blocklist.keywordAddPlaceholder")}
            />
          </>
        )}
        <Typography.Text type="secondary">
          {t("applySettings.blocklist.keywordsHint")}
        </Typography.Text>
      </div>

      <div>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          {t("applySettings.blocklist.save")}
        </Button>
      </div>
    </Space>
  );
}

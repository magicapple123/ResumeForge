// SPDX-License-Identifier: Apache-2.0
import { App, Button, Card, Switch, Tag, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import { useMemo, useState } from "react";
import { saveNavigationVisibility } from "../../api/settings";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useNavigationVisibility } from "../../hooks/useNavigationVisibility";
import {
  CORE_NAVIGATION_KEYS,
  NAVIGATION_ITEMS,
  type NavigationGroup,
  type NavigationItem,
} from "../navigation/navigationConfig";
import { publishHiddenNavigationKeys } from "../../utils/navigationVisibility";
import "./navigationSettings.css";

const GROUPS: NavigationGroup[] = ["primary", "space"];
const GROUP_LABELS: Record<NavigationGroup, MessageKey> = {
  primary: "navigation.settings.group.primary",
  space: "navigation.settings.group.space",
};

interface ItemRowProps {
  item: NavigationItem;
  hidden: Set<string>;
  loading: boolean;
  savingKey: string | null;
  onToggle: (item: NavigationItem, visible: boolean) => void;
}

/** 一行导航入口：图标 + 名称（核心入口带「固定显示」Tag）+ 右侧开关。 */
function NavigationItemRow({ item, hidden, loading, savingKey, onToggle }: ItemRowProps) {
  useLocale();
  const required = CORE_NAVIGATION_KEYS.has(item.key);
  const visible = required || !hidden.has(item.key);
  return (
    <div className="navigation-settings-item">
      <span className="navigation-settings-icon">{item.icon}</span>
      <span className="navigation-settings-label">{t(item.labelKey)}</span>
      {required ? <Tag color="blue">{t("navigation.settings.fixed")}</Tag> : null}
      <Switch
        checked={visible}
        disabled={required || loading || savingKey !== null}
        loading={savingKey === item.key}
        onChange={(checked) => onToggle(item, checked)}
        aria-label={t("navigation.settings.switchAria", { name: t(item.labelKey) })}
      />
    </div>
  );
}

export default function NavigationSettingsCard() {
  useLocale();
  const { message } = App.useApp();
  const { hiddenKeys, loading } = useNavigationVisibility();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const hidden = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);

  const save = async (nextHidden: string[], key: string | null = null) => {
    setSavingKey(key ?? "all");
    try {
      const saved = await saveNavigationVisibility(nextHidden);
      publishHiddenNavigationKeys(saved.hidden);
      message.success(t("navigation.settings.saved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("navigation.settings.saveFailed"));
    } finally {
      setSavingKey(null);
    }
  };

  const toggle = (item: NavigationItem, visible: boolean) => {
    if (item.required) return;
    const nextHidden = visible
      ? hiddenKeys.filter((key) => key !== item.key)
      : [...hiddenKeys, item.key];
    void save(nextHidden, item.key);
  };

  return (
    <Card
      className="settings-card navigation-settings-card"
      title={t("navigation.settings.title")}
      extra={
        <Button
          size="small"
          disabled={loading || savingKey !== null || hiddenKeys.length === 0}
          loading={savingKey === "all"}
          onClick={() => void save([])}
        >
          {t("navigation.settings.restore")}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" className="navigation-settings-intro">
        {t("navigation.settings.intro")}
      </Typography.Paragraph>
      {/* 按 group 分「核心入口 / 我的空间」两块，组内两列网格（窄屏单列）的紧凑布局。 */}
      <LoadingBlock spinning={loading}>
        <div className="navigation-settings-groups">
          {GROUPS.map((group) => (
            <section key={group} className="navigation-settings-group">
              <Typography.Text type="secondary" className="navigation-settings-group-title">
                {t(GROUP_LABELS[group])}
              </Typography.Text>
              <div className="navigation-settings-grid">
                {NAVIGATION_ITEMS.filter((item) => item.group === group).map((item) => (
                  <NavigationItemRow
                    key={item.key}
                    item={item}
                    hidden={hidden}
                    loading={loading}
                    savingKey={savingKey}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </LoadingBlock>
    </Card>
  );
}

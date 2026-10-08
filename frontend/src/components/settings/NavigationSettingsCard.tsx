import { App, Button, Card, Spin, Switch, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { saveNavigationVisibility } from "../../api/settings";
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
const GROUP_LABELS: Record<NavigationGroup, string> = {
  primary: "核心入口",
  space: "我的空间",
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
  const required = CORE_NAVIGATION_KEYS.has(item.key);
  const visible = required || !hidden.has(item.key);
  return (
    <div className="navigation-settings-item">
      <span className="navigation-settings-icon">{item.icon}</span>
      <span className="navigation-settings-label">{item.label}</span>
      {required ? <Tag color="blue">固定显示</Tag> : null}
      <Switch
        checked={visible}
        disabled={required || loading || savingKey !== null}
        loading={savingKey === item.key}
        onChange={(checked) => onToggle(item, checked)}
        aria-label={item.label + "导航入口"}
      />
    </div>
  );
}

export default function NavigationSettingsCard() {
  const { message } = App.useApp();
  const { hiddenKeys, loading } = useNavigationVisibility();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const hidden = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);

  const save = async (nextHidden: string[], key: string | null = null) => {
    setSavingKey(key ?? "all");
    try {
      const saved = await saveNavigationVisibility(nextHidden);
      publishHiddenNavigationKeys(saved.hidden);
      message.success("导航显示设置已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存导航显示设置失败");
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
      title="界面与导航"
      extra={
        <Button
          size="small"
          disabled={loading || savingKey !== null || hiddenKeys.length === 0}
          loading={savingKey === "all"}
          onClick={() => void save([])}
        >
          恢复默认显示
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" className="navigation-settings-intro">
        隐藏只会移除导航入口，不会删除数据，也不会禁止直接访问对应页面。首页、岗位广场、简历中心、我的资料、投递台和设置始终保留。
      </Typography.Paragraph>
      {/* 按 group 分「核心入口 / 我的空间」两块，组内两列网格（窄屏单列）的紧凑布局。 */}
      <Spin spinning={loading}>
        <div className="navigation-settings-groups">
          {GROUPS.map((group) => (
            <section key={group} className="navigation-settings-group">
              <Typography.Text type="secondary" className="navigation-settings-group-title">
                {GROUP_LABELS[group]}
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
      </Spin>
    </Card>
  );
}

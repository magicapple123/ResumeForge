import { App, Button, Card, Listy, Space, Spin, Switch, Tag, Typography } from "antd";
import { ListyItem, ListyMeta } from "../common/ListyItem";
import { useMemo, useState } from "react";
import { saveNavigationVisibility } from "../../api/settings";
import { useNavigationVisibility } from "../../hooks/useNavigationVisibility";
import {
  CORE_NAVIGATION_KEYS,
  NAVIGATION_ITEMS,
  type NavigationItem,
} from "../navigation/navigationConfig";
import { publishHiddenNavigationKeys } from "../../utils/navigationVisibility";

const NAVIGATION_HINTS: Record<string, string> = {
  "/webform": "在专用浏览器中读取并填写网申表单",
  "/tracker": "跟踪岗位投递、面试和后续进展",
  "/interview": "练习面试并生成复盘记录",
  "/assistant": "使用求职助手整理资料和问题",
  "/favorites": "集中查看收藏的岗位",
  "/materials": "管理附件、作品和求职材料",
  "/knowledge": "沉淀求职知识与经验",
  "/skills": "维护技能和自定义工作台内容",
  "/analytics": "查看投递与求职数据统计",
  "/claims": "核对简历事实和证据来源",
  "/trash": "恢复或清理已软删除的记录",
};

function itemDescription(item: NavigationItem): string {
  if (CORE_NAVIGATION_KEYS.has(item.key)) return "核心入口，始终显示";
  return NAVIGATION_HINTS[item.key] ?? "可按需要隐藏的功能模块";
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
        <Space size={8}>
          <Button
            size="small"
            disabled={loading || savingKey !== null || hiddenKeys.length === 0}
            loading={savingKey === "all"}
            onClick={() => void save([])}
          >
            恢复默认显示
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" className="navigation-settings-intro">
        隐藏只会移除导航入口，不会删除数据，也不会禁止直接访问对应页面。首页、岗位广场、简历中心、我的资料、投递台和设置始终保留。
      </Typography.Paragraph>
      {/* List 的 loading 是内容外层的 Spin。 */}
      <Spin spinning={loading}>
        <Listy
          items={NAVIGATION_ITEMS}
          rowKey={(item) => item.key}
          itemRender={(item) => {
            const required = CORE_NAVIGATION_KEYS.has(item.key);
            const visible = required || !hidden.has(item.key);
            return (
              <ListyItem
                className="navigation-settings-item"
                actions={[
                  <Switch
                    key="toggle"
                    checked={visible}
                    disabled={required || loading || savingKey !== null}
                    loading={savingKey === item.key}
                    onChange={(checked) => toggle(item, checked)}
                    aria-label={item.label + "导航入口"}
                  />,
                ]}
              >
                <ListyMeta
                  avatar={<span className="navigation-settings-icon">{item.icon}</span>}
                  title={
                    <Space size={8}>
                      <span>{item.label}</span>
                      {required ? <Tag color="blue">固定显示</Tag> : null}
                      <Typography.Text type="secondary">
                        {item.group === "primary" ? "主导航" : "我的空间"}
                      </Typography.Text>
                    </Space>
                  }
                  description={itemDescription(item)}
                />
              </ListyItem>
            );
          }}
        />
      </Spin>
    </Card>
  );
}

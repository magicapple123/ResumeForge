// SPDX-License-Identifier: Apache-2.0
/**
 * 职业场景紧凑选择器（A2）：antd Select + 场景管理入口。
 *
 * - 页头常驻使用（与数据集选择器分开，不共享"在哪份数据里"的语义）；
 * - 只切换**本窗口**的引导建议：改的是 sessionStorage 里的 id，不发任何业务写请求；
 * - 列表加载失败只把 Select 标成 warning 并在下拉里给出重试，不阻断其他功能；
 * - 独立组件：也可以挂到页面内（如简历中心的场景建议卡）。
 */
import { PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Divider, Select, Space, Tooltip, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import EmptyState from "../../components/common/EmptyState";
import ErrorState from "../../components/common/ErrorState";
import ScenarioEditor from "./ScenarioEditor";
import type { CareerScenario, CareerScenarioPreset } from "./types";
import { useScenarioSelection } from "./useScenarioSelection";

/** Select 里"不指定场景"的哨兵值（真实 id 都是正整数）。 */
const UNSET_VALUE = -1;

interface Props {
  /** 页面内使用时显示「职业场景」标签；页头紧凑模式不显示。 */
  showLabel?: boolean;
  className?: string;
}

interface EditorTarget {
  scenario: CareerScenario | null;
  preset: CareerScenarioPreset | null;
}

export default function ScenarioSelector({ showLabel = false, className }: Props) {
  const {
    scenarios,
    loading,
    error,
    selectedScenarioId,
    selectedScenario,
    selectScenario,
    reload,
  } = useScenarioSelection();
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  const openCreate = () => setEditor({ scenario: null, preset: null });
  const openEdit = () => setEditor({ scenario: selectedScenario, preset: null });

  /**
   * 加载失败且一条都没拿到时把下拉留空：空列表才会渲染 notFoundContent，
   * 于是错误态（ErrorState + 重试）有地方出现。此前永远塞着「不指定场景」这一项，
   * notFoundContent 成了永不执行的死代码。
   */
  const listUnavailable = error !== "" && scenarios.length === 0;
  const options = listUnavailable
    ? []
    : [
        { value: UNSET_VALUE, label: t("careerScenarios.selector.unset") },
        ...scenarios.map((item) => ({ value: item.id, label: item.name })),
      ];

  return (
    <Space size={6} align="center" className={className}>
      {showLabel ? (
        <Typography.Text type="secondary">{t("careerScenarios.selector.label")}</Typography.Text>
      ) : null}
      <Select
        // 固定 id：rc-util 在测试环境把所有 useId 都返回 "test-id"，页头常驻的
        // Select 会抢走弹窗 aria-labelledby 指向的 id（同 ModelProfileSelect 的处理），
        // 让按"角色 + 名称"查询对话框在 App 级测试里全部失效。
        id="global-career-scenario-select"
        style={{ width: 176 }}
        aria-label={t("careerScenarios.selector.aria")}
        value={listUnavailable ? undefined : (selectedScenarioId ?? UNSET_VALUE)}
        placeholder={t("careerScenarios.selector.unset")}
        loading={loading}
        showSearch
        optionFilterProp="label"
        status={error ? "warning" : undefined}
        onChange={(value: number) => selectScenario(value === UNSET_VALUE ? null : value)}
        options={options}
        popupRender={(menu) => (
          <>
            {menu}
            <Divider style={{ margin: "4px 0" }} />
            <Space size={4} style={{ padding: "4px 8px" }}>
              <Button type="link" size="small" icon={<PlusOutlined />} onClick={openCreate}>
                {t("careerScenarios.selector.create")}
              </Button>
              {selectedScenario ? (
                <Button type="link" size="small" onClick={openEdit}>
                  {t("careerScenarios.selector.editCurrent")}
                </Button>
              ) : null}
            </Space>
          </>
        )}
        notFoundContent={
          error ? (
            <ErrorState
              description={t("careerScenarios.selector.error")}
              onRetry={() => void reload()}
              retrying={loading}
            />
          ) : (
            <EmptyState inline description={t("careerScenarios.selector.empty")} />
          )
        }
      />
      <Tooltip title={t("careerScenarios.selector.manage")}>
        <Button
          icon={<SettingOutlined />}
          aria-label={t("careerScenarios.selector.manageAria")}
          onClick={selectedScenario ? openEdit : openCreate}
        />
      </Tooltip>
      <ScenarioEditor
        open={editor !== null}
        scenario={editor?.scenario ?? null}
        initialPreset={editor?.preset ?? null}
        onClose={() => setEditor(null)}
        onSaved={(saved) => {
          void reload();
          selectScenario(saved.id);
        }}
      />
    </Space>
  );
}

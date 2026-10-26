// SPDX-License-Identifier: Apache-2.0
/**
 * 职业场景紧凑选择器（A2）：antd Select + 场景管理入口。
 *
 * - 页头常驻使用（与数据集选择器分开，不共享"在哪份数据里"的语义）；
 * - 只切换**本窗口**的引导建议：改的是 sessionStorage 里的 id，不发任何业务写请求；
 * - 列表加载失败只把 Select 标成 warning 并在下拉里给出重试，不阻断其他功能；
 * - 独立组件：也可以挂到页面内（如简历中心的场景建议卡）。
 */
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
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
  /** 保存后是否切到这条场景：新建、或编辑的正是当前场景时为真。 */
  selectAfterSave: boolean;
}

export default function ScenarioSelector({ showLabel = false, className }: Props) {
  const { scenarios, loading, error, selectedScenarioId, selectScenario, reload } =
    useScenarioSelection();
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  // 下拉展开态由本组件持有：点某个选项右侧的编辑按钮时要先把下拉收起来，
  // 否则编辑器弹层关掉之后下拉还挂在那里。
  const [open, setOpen] = useState(false);

  const openCreate = () => {
    setOpen(false);
    setEditor({ scenario: null, preset: null, selectAfterSave: true });
  };
  const openEdit = (scenario: CareerScenario) => {
    setOpen(false);
    setEditor({
      scenario,
      preset: null,
      selectAfterSave: scenario.id === selectedScenarioId,
    });
  };

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
        open={open}
        onOpenChange={setOpen}
        // 每条场景右侧一个编辑入口：编辑的是**这一条**，不是「当前场景」。
        // 选项本身仍是「点击即选中」，所以按钮要吃掉 mousedown/click，避免连带选中。
        optionRender={(option) => {
          const scenario = scenarios.find((item) => item.id === option.value);
          if (!scenario) return option.label;
          return (
            <span className="scenario-option">
              <span className="scenario-option-name">{option.label}</span>
              <Tooltip title={t("careerScenarios.selector.edit")}>
                <Button
                  type="text"
                  size="small"
                  className="scenario-option-edit"
                  icon={<EditOutlined />}
                  aria-label={t("careerScenarios.selector.editAria", { name: scenario.name })}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openEdit(scenario);
                  }}
                />
              </Tooltip>
            </span>
          );
        }}
        popupRender={(menu) => (
          <>
            {menu}
            <Divider style={{ margin: "4px 0" }} />
            <Space size={4} style={{ padding: "4px 8px" }}>
              <Button type="link" size="small" icon={<PlusOutlined />} onClick={openCreate}>
                {t("careerScenarios.selector.create")}
              </Button>
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
      <ScenarioEditor
        open={editor !== null}
        scenario={editor?.scenario ?? null}
        initialPreset={editor?.preset ?? null}
        onClose={() => setEditor(null)}
        onSaved={(saved) => {
          const selectAfterSave = editor?.selectAfterSave ?? false;
          void reload();
          // 编辑别人那条时不要顺手把当前场景换掉。
          if (selectAfterSave) selectScenario(saved.id);
        }}
      />
    </Space>
  );
}

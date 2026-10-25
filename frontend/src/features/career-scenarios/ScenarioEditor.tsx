// SPDX-License-Identifier: Apache-2.0
/**
 * 职业场景编辑器（A2）：创建 / 编辑一份自定义场景。
 *
 * 三条规则：
 * 1. 有写入动作 → 走 FormModal 底座（mask={{ closable: false }}、footer 只放动作、
 *    提交中禁关闭、Esc 与 × 同义、脏值出内联确认条）；
 * 2. 编辑时 expected_revision 取**打开时**服务端给的 revision；409 冲突不静默覆盖，
 *    提示"场景已被其他窗口修改"并提供刷新按钮（刷新后按最新 revision 重新编辑）；
 * 3. "从快捷场景开始"只是预填表单：保存出来的是自定义场景，不改内置目录。
 */
import { Alert, App, Button, Typography } from "antd";
import { useState } from "react";
import { fetchResumeTemplates } from "../../api/resumes";
import FormModal from "../../components/common/FormModal";
import { useApi } from "../../hooks/useApi";
import { t } from "../../i18n";
import {
  createCareerScenario,
  isCareerScenarioRevisionConflict,
  listCareerScenarios,
  updateCareerScenario,
} from "./api";
import ScenarioEditorFields from "./ScenarioEditorFields";
import {
  emptyCareerScenarioConfig,
  normalizeCareerScenarioConfig,
  type CareerScenario,
  type CareerScenarioConfig,
  type CareerScenarioPreset,
} from "./types";
import { useScenarioCatalog } from "./useScenarioCatalog";

interface Props {
  open: boolean;
  /** null = 新建；非 null = 编辑这一份（expected_revision 从它带出）。 */
  scenario: CareerScenario | null;
  /** 以某个快捷场景预填表单（"另存为自定义场景"入口）；优先级低于 scenario。 */
  initialPreset?: CareerScenarioPreset | null;
  onClose: () => void;
  onSaved: (scenario: CareerScenario) => void;
}

export default function ScenarioEditor({
  open,
  scenario,
  initialPreset = null,
  onClose,
  onSaved,
}: Props) {
  const { message } = App.useApp();
  const { catalog, error: catalogError } = useScenarioCatalog(open);
  // 偏好栏目的可选项来自简历模板目录：只在编辑器打开时取一次（不增加常驻请求）。
  const { data: templateCatalog } = useApi(
    () => (open ? fetchResumeTemplates() : Promise.resolve(null)),
    [open],
  );

  const [name, setName] = useState("");
  const [config, setConfig] = useState<CareerScenarioConfig>(emptyCareerScenarioConfig);
  const [baseline, setBaseline] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 打开（或换编辑目标）时用服务端值重置表单。渲染期守卫式调整：避免 effect 里
  // 同步 setState 的级联渲染（与 GenerateResumeModal 的标题同步同一写法）。
  const targetKey =
    (open ? "open" : "closed") + ":" + (scenario?.id ?? "new") + ":" + (initialPreset?.key ?? "");
  const [lastTargetKey, setLastTargetKey] = useState<string | null>(null);
  if (lastTargetKey !== targetKey) {
    setLastTargetKey(targetKey);
    if (open) {
      const startName = scenario?.name ?? initialPreset?.name ?? "";
      const startConfig = scenario
        ? normalizeCareerScenarioConfig(scenario.config)
        : initialPreset
          ? {
              ...normalizeCareerScenarioConfig(initialPreset.config),
              include_employment_status: false,
            }
          : emptyCareerScenarioConfig();
      setName(startName);
      setConfig(startConfig);
      setBaseline(JSON.stringify({ name: startName, config: startConfig }));
      setRevision(scenario?.revision ?? null);
      setConflict(false);
    }
  }

  const dirty = open && JSON.stringify({ name, config }) !== baseline;

  const save = async (): Promise<void> => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      message.warning(t("careerScenarios.editor.nameRequired"));
      return;
    }
    setConflict(false);
    try {
      const saved =
        scenario && revision != null
          ? await updateCareerScenario(scenario.id, {
              name: trimmedName,
              config,
              expected_revision: revision,
            })
          : await createCareerScenario({ name: trimmedName, config });
      message.success(
        scenario ? t("careerScenarios.editor.saved") : t("careerScenarios.editor.created"),
      );
      onSaved(saved);
      onClose();
    } catch (err) {
      if (isCareerScenarioRevisionConflict(err)) {
        // 409：另一窗口先改了。不能静默用新版覆盖——让用户刷新后自己比较。
        setConflict(true);
        return;
      }
      message.error(err instanceof Error ? err.message : t("careerScenarios.editor.saveFailed"));
    }
  };

  const refreshAfterConflict = async (): Promise<void> => {
    if (!scenario || refreshing) return;
    setRefreshing(true);
    try {
      const { items } = await listCareerScenarios();
      const latest = items.find((item) => item.id === scenario.id);
      if (!latest) {
        message.warning(t("careerScenarios.editor.gone"));
        onClose();
        return;
      }
      const latestConfig = normalizeCareerScenarioConfig(latest.config);
      setName(latest.name);
      setConfig(latestConfig);
      setBaseline(JSON.stringify({ name: latest.name, config: latestConfig }));
      setRevision(latest.revision);
      setConflict(false);
      message.success(t("careerScenarios.editor.refreshed"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("careerScenarios.editor.saveFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <FormModal
      open={open}
      title={
        scenario ? t("careerScenarios.editor.editTitle") : t("careerScenarios.editor.createTitle")
      }
      okText={
        scenario ? t("careerScenarios.editor.saveEdit") : t("careerScenarios.editor.saveCreate")
      }
      width={720}
      dirty={dirty}
      onCancel={onClose}
      onSubmit={save}
    >
      {conflict ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={t("careerScenarios.editor.conflictTitle")}
          description={t("careerScenarios.editor.conflictBody")}
          action={
            <Button size="small" loading={refreshing} onClick={() => void refreshAfterConflict()}>
              {t("careerScenarios.editor.conflictRefresh")}
            </Button>
          }
        />
      ) : null}
      {catalogError ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={t("careerScenarios.editor.catalogError")}
        />
      ) : null}
      <ScenarioEditorFields
        name={name}
        setName={setName}
        config={config}
        setConfig={setConfig}
        presets={catalog?.presets ?? []}
        sectionOptions={templateCatalog?.section_options ?? []}
        nameMaxLength={catalog?.limits?.max_name_chars ?? 40}
        expressionMaxLength={catalog?.limits?.max_expression_preferences ?? 800}
      />
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
        {t("careerScenarios.editor.previewHint")}
      </Typography.Text>
    </FormModal>
  );
}

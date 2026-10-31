// SPDX-License-Identifier: Apache-2.0
/**
 * 「网申资料」自定义字段的**增 / 改名 / 删**（唯一实现）。
 *
 * ## 为什么抽成 hook
 *
 * 这组回调原先住在 `WebFormProfileSection` 里（约 130 行）。现在卡片底部要长出「自定义」
 * 分组卡片里的那个「添加自定义字段」输入框，Section 再涨就破 500 行预算
 * （`backend/tests/test_file_size_budget.py`）。它们本来就是一个职责：**改字段清单**，
 * 与渲染无关，搬出来是把"改清单"和"画清单"分开。
 *
 * ## 两条不能丢的约定
 *
 * 1. **唯一实现**：手动添加与「粘贴文本识别」写入都走 `addCustomField`，不要复制第二份。
 * 2. **顺序**：新增字段必须**先落名字、再写值**（`details[key].label` 先写），反了会闪
 *    一帧"有值没名字"的字段。
 *
 * ## 为什么用 ref 读 values / details / profile
 *
 * `values` / `details` 每击键都换新对象，直接进依赖数组会让 `handleAddCustomField` 每次
 * 重建（连带把卡片的 memo 打穿）。点击发生在渲染提交之后，ref 里已是最新值。
 * `profileRef` 解决的是另一件事：**同一批**里连续新增多个字段时 `setProfile` 还没落地，
 * 闭包里的 `profile` 对每次调用都是旧的，第二次会把第一次建的字段覆盖掉。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { t } from "../../i18n";
import { WEBFORM_CUSTOM_GROUP } from "../../features/webform/groupIdentity";
import type { WebFormExtraEntry, WebFormExtraProfile, WebFormField } from "../../types";
import { customFieldKey, isCustomField, normalizeFieldLabel } from "./WebFormProfileFieldUtils";

/** 编辑态的值由宿主页面持有（这样它能和资料表单一起提交）。 */
export type ExtraProfileValues = Record<string, string>;

export interface WebFormCustomFieldsOptions {
  profile: WebFormExtraProfile | null;
  setProfile: Dispatch<SetStateAction<WebFormExtraProfile | null>>;
  values: ExtraProfileValues;
  details: Record<string, WebFormExtraEntry>;
  /** 字段的展示名（`details` 里用户改过的名字优先，否则按目录查表）。 */
  displayLabel: (field: WebFormField) => string;
  onChange: (key: string, value: string) => void;
  onFieldLabelChange: (key: string, label: string) => void;
  onFieldDelete: (key: string) => void;
  /** 字段清单变了要交回宿主（宿主据此渲染与提交）。 */
  onLoaded: (profile: WebFormExtraProfile) => void;
  /** 报告/清除错误（重名、空名）。传 `setError` 即可，`""` 表示清除。 */
  onError: (message: string) => void;
}

export interface WebFormCustomFields {
  customLabel: string;
  setCustomLabel: (value: string) => void;
  addCustomField: (label: string, keyOverride?: string) => string | null;
  handleAddCustomField: () => void;
  handleRenameCustomField: (key: string, nextLabel: string) => string | undefined;
  handleDeleteCustomField: (key: string) => void;
}

export function useWebFormCustomFields({
  profile,
  setProfile,
  values,
  details,
  displayLabel,
  onChange,
  onFieldLabelChange,
  onFieldDelete,
  onLoaded,
  onError,
}: WebFormCustomFieldsOptions): WebFormCustomFields {
  const [customLabel, setCustomLabel] = useState("");

  // values/details 每击键都换新，会把 handleAddCustomField 每次重建。改用 ref 读最新值
  // （点击发生在渲染提交之后，ref 已是最新），把该回调的依赖收敛到稳定项。
  const addCustomFieldContextRef = useRef({ values, details });
  useEffect(() => {
    addCustomFieldContextRef.current = { values, details };
  });

  /**
   * 字段清单的 ref：**同一批**里连续新增多个自定义字段时，`setProfile` 还没落地，
   * 闭包里的 `profile` 会对每一次调用都是旧的（第二次会把第一次建的字段覆盖掉）。
   * ref 在调用瞬间同步推进，所以"一次识别新增 3 个字段"能全部留住。
   */
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  });

  const handleRenameCustomField = useCallback(
    (key: string, nextLabel: string): string | undefined => {
      const label = nextLabel.trim();
      if (!label) return t("profileLibrary.webform.fieldNameEmpty");
      const duplicate = profile?.fields.some(
        (field) =>
          field.key !== key &&
          isCustomField(field) &&
          normalizeFieldLabel(displayLabel(field)) === normalizeFieldLabel(label),
      );
      if (duplicate) return t("profileLibrary.webform.duplicateName");
      onError("");

      setProfile((current) => {
        if (!current) return current;
        return {
          ...current,
          fields: current.fields.map((field) => (field.key === key ? { ...field, label } : field)),
        };
      });
      onFieldLabelChange(key, label);
      onError("");
      return undefined;
    },
    [displayLabel, onError, onFieldLabelChange, profile, setProfile],
  );

  const handleDeleteCustomField = useCallback(
    (key: string) => {
      setProfile((current) => {
        if (!current) return current;
        return { ...current, fields: current.fields.filter((field) => field.key !== key) };
      });
      onFieldDelete(key);
      onError("");
    },
    [onError, onFieldDelete, setProfile],
  );

  /** 找已存在的自定义字段：同 key（后端给的 `CUSTOM_`）或同显示名都算。 */
  const findExistingCustomField = useCallback(
    (label: string, keyOverride?: string): string | null => {
      const target = normalizeFieldLabel(label);
      for (const field of profileRef.current?.fields ?? []) {
        if (!isCustomField(field)) continue;
        if (keyOverride && field.key === keyOverride) return field.key;
        if (target && normalizeFieldLabel(displayLabel(field)) === target) return field.key;
      }
      return null;
    },
    [displayLabel],
  );

  /**
   * 新增一个自定义字段（**唯一实现**：手动添加与识别写入都走它）。
   *
   * @param label 用户看到的栏目名。
   * @param keyOverride 后端给的 key（识别链路用）。只接受 `CUSTOM_` 前缀——D32：
   *   **前端不重新生成 key**，识别结果里的 key 是后端按 label 定的，前端只负责沿用它。
   * @returns 最终 key；空名或无法成 key 时返回 `null`（**已存在不算失败**，返回已有 key）。
   */
  const addCustomField = useCallback(
    (label: string, keyOverride?: string): string | null => {
      const name = label.trim();
      if (!name) return null;
      const existing = findExistingCustomField(name, keyOverride);
      if (existing) return existing;
      const key =
        keyOverride && keyOverride.startsWith("CUSTOM_") && keyOverride.length > "CUSTOM_".length
          ? keyOverride
          : customFieldKey(name);
      if (!key || key === "CUSTOM_") return null;

      const current = profileRef.current;
      const field: WebFormField = {
        key,
        label: name,
        group: WEBFORM_CUSTOM_GROUP,
        kind: "text",
        sensitive: false,
        matchable: true,
      };
      const nextProfile: WebFormExtraProfile = {
        ...(current as WebFormExtraProfile),
        groups: current?.groups.includes(WEBFORM_CUSTOM_GROUP)
          ? current.groups
          : [...(current?.groups ?? []), WEBFORM_CUSTOM_GROUP],
        fields: [...(current?.fields ?? []), field],
      };
      profileRef.current = nextProfile;
      setProfile(nextProfile);
      // onLoaded 会重置宿主的草稿：新增目录项时必须保留用户刚输入、尚未保存的值。
      const { values: latestValues, details: latestDetails } = addCustomFieldContextRef.current;
      onLoaded({ ...nextProfile, values: latestValues, details: latestDetails });
      // 名字先落（`details[key].label`）：反过来的话会闪一帧"有值没名字"的字段。
      onFieldLabelChange(key, name);
      return key;
    },
    [findExistingCustomField, onFieldLabelChange, onLoaded, setProfile],
  );

  const handleAddCustomField = useCallback(() => {
    const label = customLabel.trim();
    if (!label) return;
    if (findExistingCustomField(label)) {
      onError(t("profileLibrary.webform.duplicateField"));
      return;
    }
    const key = addCustomField(label);
    if (!key) return;
    // 新建的字段值先置空；名字已在 `addCustomField` 里写过。
    onChange(key, "");
    setCustomLabel("");
    onError("");
  }, [addCustomField, customLabel, findExistingCustomField, onChange, onError]);

  return {
    customLabel,
    setCustomLabel,
    addCustomField,
    handleAddCustomField,
    handleRenameCustomField,
    handleDeleteCustomField,
  };
}

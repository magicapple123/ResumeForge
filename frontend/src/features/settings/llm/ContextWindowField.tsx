// SPDX-License-Identifier: Apache-2.0
/**
 * 设置弹窗里的「上下文窗口」控件（T01）。
 *
 * 修的是什么：这一项此前在表单链路上**整条缺失**——`RecordFormValues` 没有这个字段，
 * 新建时填了保存即丢，编辑任何记录再保存会把窗口清成 0（`LLMConfig` 是整份替换语义，
 * 缺失字段被后端默认值 0 填回）。现在它是一条真的表单链路：值由 `Form.Item` 持有，
 * `mergedConfigFromForm` 显式读取并夹到 `0..2_000_000`。
 *
 * 控件形状：与助手面板的 `ContextWindowSelect` **同形**（32K/64K/128K/200K/1M + 自定义），
 * 预设值来自 `contextWindowPresets.ts` 同一份常量——两处显示同一组档位，用户不会以为
 * "设置里选的"和"面板里选的"是两个设置。
 *
 * 「留空 = 跟随型号参考值」：留空不写 0 当哨兵给用户看，而是把解析交给后端
 * （`resolve_model_window`：手填 > 参考表 > 保守 128K）。型号命中参考表时旁边给一颗
 * 「填入参考值」——把表里的数字**显式**写进表单，用户想固定下来时不用自己抄。
 */
import { Button, Col, Form, InputNumber, Row, Select, Space } from "antd";
import type { FormInstance } from "antd";
import { useEffect, useState } from "react";
import { getModelWindowReference } from "../../../api/settings";
import { HintDetail } from "../../../components/common/HintDetail";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { CurrentModelWindow } from "../../../types";
import type { RecordFormValues } from "../useLLMRecordTools";
import {
  CONTEXT_WINDOW_MAX,
  CONTEXT_WINDOW_PRESETS,
  clampContextWindow,
  formatContextWindow,
} from "./contextWindowPresets";

/** 「自定义…」的哨兵值：它不是窗口大小，只是让输入框冒出来（与助手侧同一做法）。 */
const CUSTOM = "custom";

interface Props {
  /** 记录弹窗的同一个 form 实例：型号从它 watch，窗口值由它托管。 */
  form: FormInstance<RecordFormValues>;
}

interface InputProps {
  /** antd `Form.Item` 注入的值。`null` / `undefined` = 留空（跟随参考值）。 */
  value?: number | null;
  /** antd `Form.Item` 注入的写回；留空时写 `null`（不写 0，语义由保存链路折成 0）。 */
  onChange?: (value: number | null) => void;
  /** 当前型号在参考表里的位置；`null` = 还没查到 / 型号为空。 */
  reference: CurrentModelWindow | null;
}

/** 受控的选择器：预设档位 + 自定义输入。值由 Form.Item 注入。 */
function ContextWindowInput({ value, onChange, reference }: InputProps) {
  const [customizing, setCustomizing] = useState(false);
  const current = typeof value === "number" && value > 0 ? value : null;
  const presetMatched = CONTEXT_WINDOW_PRESETS.some((preset) => preset.value === current);
  // 三个态：命中预设 → 显示预设；有值但不命中 → 显示「自定义」；留空 → 占位符。
  const selectValue = customizing || (current !== null && !presetMatched) ? CUSTOM : current;

  /** 「填入参考值」：把表里的数字显式写进表单（留空时也能一键固定下来）。 */
  const applyReference = () => {
    if (reference === null) return;
    setCustomizing(true);
    onChange?.(clampContextWindow(reference.tokens));
  };

  return (
    <Space direction="vertical" size={4} style={{ width: "100%" }}>
      <Select
        className="llm-context-window-select"
        value={selectValue ?? undefined}
        placeholder={t("llmRecord.contextWindow.placeholder")}
        // 允许清空：清空回到「跟随参考值」，而不是留着一个说不清的 0。
        allowClear
        options={[
          ...CONTEXT_WINDOW_PRESETS.map((preset) => ({
            value: preset.value,
            label: t(preset.labelKey),
          })),
          { value: CUSTOM, label: t("contextUsage.window.custom") },
        ]}
        onChange={(next) => {
          // 预设档位是数字；「自定义」是哨兵字符串。清空时 antd 会给 undefined——
          // 走到最后那个分支，写回 null（= 跟随参考值），而不是留一个说不清的 0。
          if (typeof next === "number") {
            setCustomizing(false);
            onChange?.(clampContextWindow(next));
            return;
          }
          if (next === CUSTOM) {
            setCustomizing(true);
            return;
          }
          setCustomizing(false);
          onChange?.(null);
        }}
        style={{ width: "100%" }}
      />
      {selectValue === CUSTOM ? (
        <InputNumber
          className="llm-context-window-custom"
          min={1}
          max={CONTEXT_WINDOW_MAX}
          step={1024}
          style={{ width: "100%" }}
          value={current}
          placeholder={t("contextUsage.window.customPlaceholder")}
          onChange={(next) =>
            onChange?.(typeof next === "number" ? clampContextWindow(next) : null)
          }
        />
      ) : null}
      {/* 只有**命中参考表**时才给这颗按钮：未知型号的 128K 是保守估算，把它写成
          "用户确认过的手填值"反而掩盖了"这个数不是查到的"这件事。 */}
      {reference !== null && reference.source === "reference" ? (
        <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={applyReference}>
          {t("llmRecord.contextWindow.applyReference", {
            window: formatContextWindow(reference.tokens),
          })}
        </Button>
      ) : null}
    </Space>
  );
}

/**
 * 「上下文窗口」一行（标签 + ⓘ + 控件）。
 *
 * 型号变化时就查一次参考表（只读接口，零上游调用）：查不到或失败都只是不显示
 * 「填入参考值」，不影响用户手填——参考值是锦上添花，不该让表单报错。
 */
export default function ContextWindowField({ form }: Props) {
  useLocale();
  const target = (Form.useWatch("model", form) ?? "").trim();
  // 参考值按**型号**存，而不是"查到了就记住"：`reference` 只在型号与查询时一致时才生效。
  // 这样"型号被清空/换掉"不需要在 effect 里同步 setState（那会触发级联渲染，
  // `react-hooks/set-state-in-effect` 直接报错），换型号到拿到新结果之间自然回落成 null。
  const [resolved, setResolved] = useState<{
    model: string;
    current: CurrentModelWindow | null;
  }>({ model: "", current: null });
  const reference = resolved.model === target ? resolved.current : null;

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    void getModelWindowReference(target)
      .then((data) => {
        if (!cancelled) setResolved({ model: target, current: data.current });
      })
      .catch(() => {
        // 参考表拿不到就不给按钮：表单本身仍然可用，不让一个只读查询挡住保存。
        if (!cancelled) setResolved({ model: target, current: null });
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  return (
    <Row gutter={16}>
      <Col xs={24} md={8}>
        <Form.Item
          name="context_window_tokens"
          label={
            <Space size={4} wrap={false}>
              {t("llmRecord.field.contextWindow")}
              <HintDetail
                detail={t("llmRecord.hint.contextWindow")}
                label={t("llmRecord.aria.contextWindow")}
              />
            </Space>
          }
        >
          <ContextWindowInput reference={reference} />
        </Form.Item>
      </Col>
    </Row>
  );
}

// SPDX-License-Identifier: Apache-2.0
/**
 * 高级调整折叠块的内部内容：Top P / Top K、惩罚项、随机种子、停止词、思考参数形态。
 * （**零 props**——纯 Form.Item name 注册在调用方持有的父 Form 上，弹窗/页面表单通用。）
 *
 * ## I-17：长解释走 `ⓘ`，短解释留 tooltip
 *
 * 这里有 9 个参数，其中 6 条解释是 36~113 字（思考预算 113、思考形态 84、Top K 53、
 * Top P 49、重复惩罚 41、停止词 36）。它们原先都是 `Form.Item tooltip`——antd 会渲成
 * label 后面的 `?`，**悬停才出来、移开就没了**：读不完，也无法用键盘/触屏读到。
 *
 * 现在按长度分载体（与 `components/common/HintDetail.tsx` 的取舍一致）：
 * - ≥36 字 → `<HintLabel>`（label + `ⓘ`，点开是常驻 Popover，提示模式 `Alt+H` 下原地展开）；
 * - ≤20 字的那三条（频率惩罚 / 存在惩罚 / 随机种子）继续用 antd 的 `tooltip`：
 *   它们只回答"这是什么"，正是 tooltip 该干的活。
 *
 * 正文一个字都没改：`advancedParams.tooltip.*` 仍是唯一措辞来源，这里只补了
 * `advancedParams.aria.*`（"这个按钮点开的是什么"），避免同一句话在两处漂移。
 */
import { Alert, Col, Form, InputNumber, Row, Select } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { HintLabel } from "../../../components/common/HintDetail";
import { THINKING_STYLE_OPTIONS } from "./thinkingMeta";

export function AdvancedParamsSection() {
  useLocale();
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title={t("advancedParams.alert.emptyNotSent")}
      />
      <Row gutter={[16, 0]}>
        <Col xs={24} md={6}>
          <Form.Item
            name="top_p"
            label={
              <HintLabel
                text="Top P"
                detail={t("advancedParams.tooltip.topP")}
                hintLabel={t("advancedParams.aria.topP")}
              />
            }
          >
            <InputNumber
              min={0}
              max={1}
              step={0.05}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="frequency_penalty"
            label={t("advancedParams.field.frequencyPenalty")}
            tooltip={t("advancedParams.tooltip.frequencyPenalty")}
          >
            <InputNumber
              min={-2}
              max={2}
              step={0.1}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="presence_penalty"
            label={t("advancedParams.field.presencePenalty")}
            tooltip={t("advancedParams.tooltip.presencePenalty")}
          >
            <InputNumber
              min={-2}
              max={2}
              step={0.1}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="seed"
            label={t("advancedParams.field.seed")}
            tooltip={t("advancedParams.tooltip.seed")}
          >
            <InputNumber
              min={0}
              step={1}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="top_k"
            label={
              <HintLabel
                text="Top K"
                detail={t("advancedParams.tooltip.topK")}
                hintLabel={t("advancedParams.aria.topK")}
              />
            }
          >
            <InputNumber
              min={0}
              max={1000}
              step={1}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="repetition_penalty"
            label={
              <HintLabel
                text={t("advancedParams.field.repetitionPenalty")}
                detail={t("advancedParams.tooltip.repetitionPenalty")}
                hintLabel={t("advancedParams.aria.repetitionPenalty")}
              />
            }
          >
            <InputNumber
              min={0}
              max={2}
              step={0.05}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="thinking_budget"
            label={
              <HintLabel
                text={t("advancedParams.field.thinkingBudget")}
                detail={t("advancedParams.tooltip.thinkingBudget")}
                hintLabel={t("advancedParams.aria.thinkingBudget")}
              />
            }
          >
            <InputNumber
              min={0}
              max={100000}
              step={1024}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="thinking_style"
            label={
              <HintLabel
                text={t("advancedParams.field.thinkingStyle")}
                detail={t("advancedParams.tooltip.thinkingStyle")}
                hintLabel={t("advancedParams.aria.thinkingStyle")}
              />
            }
          >
            <Select
              options={THINKING_STYLE_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="stop"
            label={
              <HintLabel
                text={t("advancedParams.field.stop")}
                detail={t("advancedParams.tooltip.stop")}
                hintLabel={t("advancedParams.aria.stop")}
              />
            }
          >
            <Select
              mode="tags"
              open={false}
              suffixIcon={null}
              placeholder={t("advancedParams.placeholder.stop")}
            />
          </Form.Item>
        </Col>
      </Row>
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 4 }}
        title={t("advancedParams.alert.protocolNote")}
      />
    </>
  );
}

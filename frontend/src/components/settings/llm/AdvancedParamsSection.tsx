/**
 * 高级调整折叠块的内部内容：Top P / Top K、惩罚项、随机种子、停止词、思考参数形态。
 * （自 LLMConfigCard 拆出：:436-589 折叠块内部逐字随迁；**零 props**——纯 Form.Item name
 * 注册在卡片持有的父 Form 上；advancedOpen 条件渲染留在卡片。）
 */
import { Alert, Col, Form, InputNumber, Row, Select } from "antd";
import { THINKING_STYLE_OPTIONS } from "./thinkingMeta";

export function AdvancedParamsSection() {
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title="留空的参数不会发送给模型服务，由服务商使用默认值。这些参数并非所有服务商都支持，填写前请先看官方文档。"
      />
      <Row gutter={[16, 0]}>
        <Col xs={24} md={6}>
          <Form.Item
            name="top_p"
            label="Top P"
            tooltip="核采样：只从累计概率达到该值的候选里取词。与 temperature 叠加使用，通常只调其中一个。"
          >
            <InputNumber
              min={0}
              max={1}
              step={0.05}
              style={{ width: "100%" }}
              placeholder="留空 = 不发送"
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="frequency_penalty"
            label="频率惩罚"
            tooltip="-2 到 2。正值降低重复用词，负值鼓励重复。"
          >
            <InputNumber
              min={-2}
              max={2}
              step={0.1}
              style={{ width: "100%" }}
              placeholder="留空 = 不发送"
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="presence_penalty"
            label="存在惩罚"
            tooltip="-2 到 2。正值鼓励谈新话题，负值让模型更贴题。"
          >
            <InputNumber
              min={-2}
              max={2}
              step={0.1}
              style={{ width: "100%" }}
              placeholder="留空 = 不发送"
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="seed"
            label="随机种子"
            tooltip="固定种子后同一请求更容易复现相同输出；是否生效取决于服务商。"
          >
            <InputNumber min={0} step={1} style={{ width: "100%" }} placeholder="留空 = 不发送" />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="top_k"
            label="Top K"
            tooltip="只在概率最高的 K 个候选里取词。Anthropic 与部分开源模型支持；OpenAI 官方接口会忽略它。"
          >
            <InputNumber
              min={0}
              max={1000}
              step={1}
              style={{ width: "100%" }}
              placeholder="留空 = 不发送"
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="repetition_penalty"
            label="重复惩罚"
            tooltip="大于 1 时抑制重复用词。与「频率惩罚」作用类似但计算方式不同，通常只用其中一个。"
          >
            <InputNumber
              min={0}
              max={2}
              step={0.05}
              style={{ width: "100%" }}
              placeholder="留空 = 不发送"
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="thinking_budget"
            label="思考预算"
            tooltip="Claude 原生协议下的扩展思考 token 预算。填 0 = 明确关闭思考；留空 = 不发送该字段。仅在协议选「Anthropic 原生」时有效。填了它就以上面的「思考模式」开关为准——这是给需要精确控制预算的老用法留的。"
          >
            <InputNumber
              min={0}
              max={100000}
              step={1024}
              style={{ width: "100%" }}
              placeholder="留空 = 不发送"
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="thinking_style"
            label="思考参数形态"
            tooltip="开启思考时请求体里用哪种写法。auto = 按接口协议与服务商自动推断（多数情况选这个）；只有走中转站、自建网关，或「检测思考支持」说参数不被接受时，才需要手动换一种。"
          >
            <Select options={THINKING_STYLE_OPTIONS} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="stop"
            label="停止词"
            tooltip="模型生成到这些词就停下（最多 4 条）。回车确认一条；留空 = 不发送。"
          >
            <Select
              mode="tags"
              open={false}
              suffixIcon={null}
              placeholder="输入后回车添加，最多 4 条"
            />
          </Form.Item>
        </Col>
      </Row>
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 4 }}
        title="协议换成「Anthropic 原生」后，思考预算、Top K 等参数才有意义；换成 OpenAI 兼容时它们会被忽略。思考预算与「思考模式」是同一件事的两代写法：填了预算就以预算为准，留空则由开关与强度决定。"
      />
    </>
  );
}

/**
 * 用户资料模型中原有的网申专用字段。
 *
 * 这些字段仍然沿用 `UserProfile` 的保存链路和字段名，只把界面归到「网申资料」板块；
 * 这样不会丢失用户已有值，也不会和独立的网申补充资料表重复存储。
 */
import { Alert, Card, Col, Form, Input, Row, Select } from "antd";
import PartialDateSelect from "./PartialDateSelect";

export default function WebFormProfileLegacyFields() {
  return (
    <Card size="small" title="网申资料" className="profile-top-card" style={{ marginTop: 16 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title="这些只存在你自己的电脑上，只在你点「填充」时写进网页，不会进入简历导出，也不会随简历发给大模型。"
      />
      <Row gutter={12}>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="country_region" label="国家和地区">
            <Select
              allowClear
              placeholder="请选择"
              options={["中国大陆", "中国香港", "中国澳门", "中国台湾", "其他"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="native_place" label="籍贯">
            <Input placeholder="如：山东济南" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="political_status" label="政治面貌">
            <Select
              allowClear
              placeholder="请选择"
              options={["中共党员", "中共预备党员", "共青团员", "群众", "其他"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="id_type" label="证件类型">
            <Select
              allowClear
              placeholder="请选择"
              options={[
                "居民身份证",
                "护照",
                "港澳居民来往内地通行证",
                "台湾居民来往大陆通行证",
                "其他",
              ].map((value) => ({ value, label: value }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="id_number" label="证件号码">
            <Input placeholder="身份证号" autoComplete="off" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="birth_date" label="出生日期">
            <PartialDateSelect label="出生日期" />
          </Form.Item>
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Form.Item name="phone_country_code" label="手机区号">
            <Input placeholder="+86" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="expected_salary" label="期望薪资">
            <Input placeholder="如：15-20K" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="preferred_industry" label="意向行业">
            <Input placeholder="如：互联网、互动娱乐" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="advisor" label="导师">
            <Input placeholder="校招表单常问，选填" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="research_direction" label="研究方向">
            <Input placeholder="选填" />
          </Form.Item>
        </Col>
        <Col span={24}>
          <Form.Item name="family_info" label="家庭信息">
            <Input.TextArea
              rows={2}
              placeholder="部分网申表单会问家庭成员情况，按需填写；一行一条"
            />
          </Form.Item>
        </Col>
      </Row>
    </Card>
  );
}

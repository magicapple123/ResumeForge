// SPDX-License-Identifier: Apache-2.0
/**
 * 用户资料模型中原有的网申专用字段。
 *
 * 这些字段仍然沿用 `UserProfile` 的保存链路和字段名，只把界面归到「网申资料」板块；
 * 这样不会丢失用户已有值，也不会和独立的网申补充资料表重复存储。
 *
 * **三个下拉的 `value` 是协议值**（提交给后端、还要与网申表单下拉逐字匹配），
 * 保留中文；只翻 `label`。
 */
import { Alert, Card, Col, Form, Input, Row, Select } from "antd";
import PartialDateSelect from "./PartialDateSelect";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function WebFormProfileLegacyFields() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <Card
      size="small"
      title={t("webFormLegacy.cardTitle")}
      className="profile-top-card"
      style={{ marginTop: 16 }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title={t("webFormLegacy.privacyAlert")}
      />
      <Row gutter={12}>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="country_region" label={t("webFormLegacy.field.countryRegion")}>
            <Select
              allowClear
              placeholder={t("common.placeholder.select")}
              options={[
                { value: "中国大陆", label: t("webFormLegacy.region.mainland") },
                { value: "中国香港", label: t("webFormLegacy.region.hongKong") },
                { value: "中国澳门", label: t("webFormLegacy.region.macau") },
                { value: "中国台湾", label: t("webFormLegacy.region.taiwan") },
                { value: "其他", label: t("webFormLegacy.option.other") },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="native_place" label={t("webFormLegacy.field.nativePlace")}>
            <Input placeholder={t("webFormLegacy.placeholder.nativePlace")} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="political_status" label={t("webFormLegacy.field.politicalStatus")}>
            <Select
              allowClear
              placeholder={t("common.placeholder.select")}
              options={[
                { value: "中共党员", label: t("webFormLegacy.political.cpcMember") },
                {
                  value: "中共预备党员",
                  label: t("webFormLegacy.political.cpcProbationary"),
                },
                { value: "共青团员", label: t("webFormLegacy.political.leagueMember") },
                { value: "群众", label: t("webFormLegacy.political.masses") },
                { value: "其他", label: t("webFormLegacy.option.other") },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="id_type" label={t("webFormLegacy.field.idType")}>
            <Select
              allowClear
              placeholder={t("common.placeholder.select")}
              options={[
                { value: "居民身份证", label: t("webFormLegacy.idType.residentId") },
                { value: "护照", label: t("webFormLegacy.idType.passport") },
                {
                  value: "港澳居民来往内地通行证",
                  label: t("webFormLegacy.idType.hkMacauPermit"),
                },
                {
                  value: "台湾居民来往大陆通行证",
                  label: t("webFormLegacy.idType.taiwanPermit"),
                },
                { value: "其他", label: t("webFormLegacy.option.other") },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="id_number" label={t("webFormLegacy.field.idNumber")}>
            <Input placeholder={t("webFormLegacy.placeholder.idNumber")} autoComplete="off" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="birth_date" label={t("webFormLegacy.field.birthDate")}>
            <PartialDateSelect label={t("webFormLegacy.field.birthDate")} />
          </Form.Item>
        </Col>
        <Col xs={12} sm={6} lg={4}>
          <Form.Item name="phone_country_code" label={t("webFormLegacy.field.phoneCountryCode")}>
            <Input placeholder="+86" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="expected_salary" label={t("webFormLegacy.field.expectedSalary")}>
            <Input placeholder={t("webFormLegacy.placeholder.expectedSalary")} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="preferred_industry" label={t("webFormLegacy.field.preferredIndustry")}>
            <Input placeholder={t("webFormLegacy.placeholder.preferredIndustry")} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="advisor" label={t("webFormLegacy.field.advisor")}>
            <Input placeholder={t("webFormLegacy.placeholder.advisor")} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Form.Item name="research_direction" label={t("webFormLegacy.field.researchDirection")}>
            <Input placeholder={t("webFormLegacy.placeholder.optional")} />
          </Form.Item>
        </Col>
        <Col span={24}>
          <Form.Item name="family_info" label={t("webFormLegacy.field.familyInfo")}>
            <Input.TextArea rows={2} placeholder={t("webFormLegacy.placeholder.familyInfo")} />
          </Form.Item>
        </Col>
      </Row>
    </Card>
  );
}

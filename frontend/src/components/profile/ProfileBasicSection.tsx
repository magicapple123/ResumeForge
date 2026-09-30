/** 个人资料基本信息与简历照片（多张可切换）。 */

import { Card, Col, Form, Input, Row, Select } from "antd";
import ProfilePhotoPanel from "./ProfilePhotoPanel";

interface Props {
  photo: string;
  editing: boolean;
  saving: boolean;
  /** 切换照片时同步到资料表单（照片本身在照片库里已经落库）。 */
  onPhotoSelect: (dataUrl: string) => void;
}

export default function ProfileBasicSection({ photo, editing, saving, onPhotoSelect }: Props) {
  const currentYear = new Date().getFullYear();
  const birthYears = Array.from({ length: 120 }, (_, index) => {
    const value = String(currentYear - index);
    return { value, label: value };
  });
  return (
    <Row gutter={[16, 16]} align="top" style={{ marginBottom: 16 }}>
      <Col xs={{ span: 24, order: 2 }} xl={{ span: 18, order: 1 }}>
        <Card size="small" className="profile-top-card">
          <Row gutter={12}>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: "必填" }]}>
                <Input placeholder="你的姓名" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6} lg={8}>
              <Form.Item name="gender" label="性别">
                <Select
                  allowClear
                  placeholder="请选择"
                  options={[
                    { label: "男", value: "男" },
                    { label: "女", value: "女" },
                    { label: "其他", value: "其他" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6} lg={8}>
              <Form.Item name="birth_year" label="出生年份">
                <Select allowClear placeholder="请选择" options={birthYears} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="phone" label="手机号">
                <Input placeholder="13800000000" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[{ type: "email", message: "邮箱格式不正确" }]}
              >
                <Input placeholder="you@example.com" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="city" label="所在城市">
                <Input placeholder="天津" />
              </Form.Item>
            </Col>
            {/* 微信号与 QQ 号是**普通联系方式**，所以和手机号、邮箱放在一起。
                **不要**挪到「网申资料」标签里的「网申专用资料」卡片——那张卡片的定位是"只用于填表"，
                把联系方式放进去会让人以为它们不属于基本资料。

                ⚠️ 注意别顺手写"它们会进简历生成"：**不会**。
                `services/profile/profile_context.py::build_profile_prompt_data` 是**白名单**，
                只发 name/gender/birth_year/phone/email/city/target_city/job_intent/
                personal_website/github/summary + 各子表，`wechat` 与 `qq` 都不在其中。
                这是既有的产品口径（简历上通常不印微信/QQ），不是这里漏了。
                真要改口径，改的是那份白名单，不是这个布局。 */}
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="wechat" label="微信号">
                <Input placeholder="选填" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="qq" label="QQ 号">
                <Input placeholder="选填" inputMode="numeric" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="target_city" label="意向城市">
                <Input placeholder="北京 / 深圳 / 杭州" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="job_intent" label="求职意向">
                <Input placeholder="如：市场营销专员" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="github" label="GitHub 主页">
                <Input placeholder="https://github.com/xxx" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="personal_website" label="个人网站 / 博客">
                <Input placeholder="选填" />
              </Form.Item>
            </Col>
          </Row>
        </Card>
      </Col>

      <Col xs={{ span: 24, order: 1 }} xl={{ span: 6, order: 2 }}>
        <Card size="small" title="简历照片" className="profile-top-card">
          <ProfilePhotoPanel
            activePhoto={photo}
            disabled={!editing || saving}
            onSelect={onPhotoSelect}
          />
        </Card>
      </Col>
    </Row>
  );
}

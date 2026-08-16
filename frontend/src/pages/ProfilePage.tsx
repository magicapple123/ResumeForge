/** 我的资料：基础信息 + 各分区动态列表，整体保存。 */
import { App, Button, Card, Col, Form, Input, Row, Skeleton, Typography } from "antd";
import { useEffect, useState } from "react";
import { getProfile, saveProfile } from "../api/profile";
import { AwardSection } from "../components/profile/AwardSection";
import { EducationSection } from "../components/profile/EducationSection";
import { ExperienceSection } from "../components/profile/ExperienceSection";
import { ProjectSection } from "../components/profile/ProjectSection";
import { SkillSection } from "../components/profile/SkillSection";
import type { Profile } from "../types";

export default function ProfilePage() {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getProfile()
      .then((profile) => form.setFieldsValue(profile))
      .catch((err) => message.error(err instanceof Error ? err.message : "加载资料失败"))
      .finally(() => setLoading(false));
  }, [form, message]);

  const submit = async () => {
    const values = (await form.validateFields()) as Omit<Profile, "id" | "updated_at">;
    setSaving(true);
    try {
      await saveProfile(values);
      message.success("资料已保存，现在可以去岗位广场生成简历了");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <Form form={form} layout="vertical" style={{ maxWidth: 960 }}>
      <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          简历生成只会基于这里填写的内容，AI 不会虚构经历——资料越完整，生成效果越好。
        </Typography.Paragraph>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="name" label="姓名" rules={[{ required: true, message: "必填" }]}>
              <Input placeholder="你的姓名" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="gender" label="性别">
              <Input placeholder="男 / 女" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="birth_year" label="出生年份">
              <Input placeholder="2004" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="phone" label="手机号">
              <Input placeholder="13800000000" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="email"
              label="邮箱"
              rules={[{ type: "email", message: "邮箱格式不正确" }]}
            >
              <Input placeholder="you@example.com" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="city" label="所在城市">
              <Input placeholder="天津" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="target_city" label="意向城市">
              <Input placeholder="北京 / 深圳 / 杭州" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="job_intent" label="求职意向">
              <Input placeholder="如：后端开发工程师" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="github" label="GitHub 主页">
              <Input placeholder="https://github.com/xxx" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="personal_website" label="个人网站 / 博客">
              <Input placeholder="选填" />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      <EducationSection />
      <ExperienceSection />
      <ProjectSection />
      <SkillSection />
      <AwardSection />

      <Card size="small" title="个人总结 / 自我评价" style={{ marginBottom: 16 }}>
        <Form.Item name="summary" style={{ marginBottom: 0 }}>
          <Input.TextArea
            rows={4}
            placeholder="几句话概括你的优势与特点，AI 会结合目标岗位进行润色"
          />
        </Form.Item>
      </Card>

      <Button type="primary" size="large" loading={saving} onClick={() => void submit()}>
        保存全部资料
      </Button>
    </Form>
  );
}

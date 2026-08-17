/** 我的资料：基础信息 + 各分区动态列表，整体保存。 */
import {
  CameraOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  SaveOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Col,
  Form,
  Image,
  Input,
  Row,
  Skeleton,
  Space,
  Typography,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
import { useEffect, useRef, useState } from "react";
import { getProfile, saveProfile } from "../api/profile";
import { AwardSection } from "../components/profile/AwardSection";
import { EducationSection } from "../components/profile/EducationSection";
import { ExperienceSection } from "../components/profile/ExperienceSection";
import { ProjectSection } from "../components/profile/ProjectSection";
import { SkillSection } from "../components/profile/SkillSection";
import type { Profile } from "../types";

type ProfileFormValues = Omit<Profile, "id" | "updated_at">;

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("读取照片失败"));
    reader.readAsDataURL(file);
  });
}

function toFormValues(profile: Profile): ProfileFormValues {
  return {
    photo: profile.photo,
    name: profile.name,
    gender: profile.gender,
    birth_year: profile.birth_year,
    phone: profile.phone,
    email: profile.email,
    city: profile.city,
    target_city: profile.target_city,
    job_intent: profile.job_intent,
    personal_website: profile.personal_website,
    github: profile.github,
    summary: profile.summary,
    educations: profile.educations,
    experiences: profile.experiences,
    projects: profile.projects,
    skills: profile.skills,
    awards: profile.awards,
  };
}

export default function ProfilePage() {
  const [form] = Form.useForm<ProfileFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [photoReading, setPhotoReading] = useState(false);
  const photoReadId = useRef(0);
  const savedValues = useRef<ProfileFormValues | null>(null);
  const photo = Form.useWatch("photo", form) ?? "";

  useEffect(() => {
    let active = true;
    void getProfile()
      .then((profile) => {
        if (!active) return;
        const values = toFormValues(profile);
        form.setFieldsValue(values);
        savedValues.current = values;
      })
      .catch((err) => {
        if (active) message.error(err instanceof Error ? err.message : "加载资料失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form, message]);

  useEffect(
    () => () => {
      photoReadId.current += 1;
    },
    [],
  );

  const submit = async () => {
    if (!editing || saving || photoReading) return;
    let values: ProfileFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const profile = await saveProfile(values);
      const nextValues = toFormValues(profile);
      form.setFieldsValue(nextValues);
      savedValues.current = nextValues;
      setEditing(false);
      message.success("资料已保存，现在可以去岗位广场生成简历了");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const cancelEditing = () => {
    if (saving || photoReading) return;
    if (savedValues.current) {
      form.resetFields();
      form.setFieldsValue(savedValues.current);
    }
    setEditing(false);
  };

  const beforePhotoUpload: UploadProps["beforeUpload"] = (file) => {
    if (!editing) return Upload.LIST_IGNORE;
    if (!PHOTO_TYPES.has(file.type)) {
      message.error("请选择 JPG、PNG 或 WebP 格式的照片");
      return Upload.LIST_IGNORE;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      message.error("照片不能超过 2 MB");
      return Upload.LIST_IGNORE;
    }
    const readId = ++photoReadId.current;
    setPhotoReading(true);
    void readAsDataUrl(file)
      .then((dataUrl) => {
        if (photoReadId.current === readId) form.setFieldValue("photo", dataUrl);
      })
      .catch((err) => {
        if (photoReadId.current === readId) {
          message.error(err instanceof Error ? err.message : "读取照片失败");
        }
      })
      .finally(() => {
        if (photoReadId.current === readId) setPhotoReading(false);
      });
    return false;
  };

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <div className="profile-page">
      <div className="profile-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            我的资料
          </Typography.Title>
          <Typography.Text type="secondary">维护生成简历时使用的个人信息与经历</Typography.Text>
        </div>
        <div className="profile-page-header-actions">
          {editing ? (
            <>
              <Button
                icon={<CloseOutlined />}
                disabled={saving || photoReading}
                onClick={cancelEditing}
              >
                取消
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saving}
                disabled={photoReading}
                onClick={() => void submit()}
              >
                保存全部资料
              </Button>
            </>
          ) : (
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
              编辑资料
            </Button>
          )}
        </div>
      </div>

      <Form form={form} layout="vertical" disabled={!editing || saving || photoReading}>
        <Form.Item name="photo" hidden>
          <Input />
        </Form.Item>

        <Row gutter={[16, 16]} align="stretch" style={{ marginBottom: 16 }}>
          <Col xs={{ span: 24, order: 2 }} xl={{ span: 18, order: 1 }}>
            <Card size="small" title="基本信息" className="profile-top-card">
              <Row gutter={12}>
                <Col xs={24} sm={12} lg={8}>
                  <Form.Item name="name" label="姓名" rules={[{ required: true, message: "必填" }]}>
                    <Input placeholder="你的姓名" />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={6} lg={8}>
                  <Form.Item name="gender" label="性别">
                    <Input placeholder="男 / 女" />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={6} lg={8}>
                  <Form.Item name="birth_year" label="出生年份">
                    <Input placeholder="2004" />
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
                <Col xs={24} sm={12} lg={8}>
                  <Form.Item name="target_city" label="意向城市">
                    <Input placeholder="北京 / 深圳 / 杭州" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} lg={8}>
                  <Form.Item name="job_intent" label="求职意向">
                    <Input placeholder="如：后端开发工程师" />
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
              <div className="profile-photo-panel">
                <div className="profile-photo-frame">
                  {photo ? (
                    <Image src={photo} alt="简历照片" preview={false} />
                  ) : (
                    <UserOutlined className="profile-photo-placeholder" />
                  )}
                </div>
                <Space wrap>
                  <Upload
                    accept="image/jpeg,image/png,image/webp"
                    beforeUpload={beforePhotoUpload}
                    showUploadList={false}
                    maxCount={1}
                    disabled={!editing || saving || photoReading}
                  >
                    <Button icon={<CameraOutlined />} loading={photoReading}>
                      {photo ? "更换照片" : "选择照片"}
                    </Button>
                  </Upload>
                  {photo && (
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      disabled={!editing || saving || photoReading}
                      onClick={() => form.setFieldValue("photo", "")}
                    >
                      移除
                    </Button>
                  )}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  JPG、PNG 或 WebP，最大 2 MB
                </Typography.Text>
              </div>
            </Card>
          </Col>
        </Row>

        <EducationSection editable={editing} />
        <ExperienceSection editable={editing} />
        <ProjectSection editable={editing} />
        <SkillSection editable={editing} />
        <AwardSection editable={editing} />

        <Card size="small" title="个人总结 / 自我评价" style={{ marginBottom: 16 }}>
          <Form.Item name="summary" style={{ marginBottom: 0 }}>
            <Input.TextArea
              rows={4}
              placeholder="几句话概括你的优势与特点，AI 会结合目标岗位进行润色"
            />
          </Form.Item>
        </Card>

      </Form>
    </div>
  );
}

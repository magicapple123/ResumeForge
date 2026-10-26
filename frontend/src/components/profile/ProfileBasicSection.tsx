// SPDX-License-Identifier: Apache-2.0
/**
 * 基本信息分区（F6）：定义驱动的 15 个默认字段 + 照片专门入口。
 *
 * 字段顺序/类型/收起状态全部来自服务端 SectionOut（basic_info 的定义），不再写死；
 * 照片不是普通文本（C4 照片资源例外），仍由 ProfilePhotoPanel 单独承载，不开放为
 * 自定义字段类型。旧版本遗留的网申专用项（证件号/家庭信息等）不在这里渲染。
 */
import { Card, Col, Form, Input, Row, Typography } from "antd";
import ProfilePhotoPanel from "./ProfilePhotoPanel";
import ProfileFieldInputs from "../../features/profile-library/ProfileFieldInputs";
import { t } from "../../i18n";
import type { FieldOut, LimitsOut, SectionOut } from "../../features/profile-library/types";

interface Props {
  /** basic_info 的定义；缺省时只渲染照片面板（兼容旧调用/测试夹具）。 */
  section?: SectionOut;
  photo: string;
  editing: boolean;
  saving: boolean;
  limits?: LimitsOut;
  onPhotoSelect: (dataUrl: string) => void;
  onSetPreference?: (
    field: FieldOut,
    patch: { hidden?: boolean; collapsed_override?: boolean | null },
  ) => void;
}

export default function ProfileBasicSection({
  section,
  photo,
  editing,
  saving,
  limits,
  onPhotoSelect,
  onSetPreference,
}: Props) {
  const singleLineMax = limits?.single_line_chars ?? 200;
  const multiLineMax = limits?.multi_line_chars ?? 2000;
  return (
    <Row gutter={[16, 16]} align="top" className="profile-basic-section">
      <Col xs={{ span: 24, order: 2 }} xl={{ span: 18, order: 1 }}>
        <Card size="small" className="profile-top-card">
          {/* entry_key 必须作为隐藏字段注册：antd 的 validateFields 只回注册过的字段，
              不注册会把已存条目的稳定 id 丢掉（保存时会被当成"新建"）。 */}
          <Form.Item name={["sections", "basic_info", 0, "entry_key"]} hidden>
            <Input />
          </Form.Item>
          {/* 照片不是普通文本输入（ProfileFieldInputs 按 field_type 过滤掉了 photo），
              但保存走 form.validateFields()，只回注册过的字段——不注册等于没保存：
              切换主照片后重取 workspace 会回到旧照片，简历也用旧图。 */}
          <Form.Item name={["sections", "basic_info", 0, "values", "basic_info.photo"]} hidden>
            <Input />
          </Form.Item>
          {section ? (
            <ProfileFieldInputs
              section={section}
              namePrefix={["sections", "basic_info", 0, "values"]}
              disabled={!editing || saving}
              singleLineMax={singleLineMax}
              multiLineMax={multiLineMax}
              onSetPreference={
                onSetPreference ??
                (() => {
                  return undefined;
                })
              }
            />
          ) : null}
        </Card>
      </Col>
      <Col xs={{ span: 24, order: 1 }} xl={{ span: 6, order: 2 }}>
        <Card size="small" title={t("profileLibrary.photo.title")} className="profile-top-card">
          <ProfilePhotoPanel
            activePhoto={photo}
            disabled={!editing || saving}
            onSelect={onPhotoSelect}
          />
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            {t("profileLibrary.photo.hint")}
          </Typography.Text>
        </Card>
      </Col>
    </Row>
  );
}

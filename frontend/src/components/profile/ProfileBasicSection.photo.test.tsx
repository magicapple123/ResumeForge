// SPDX-License-Identifier: Apache-2.0
/**
 * 回归守卫：主照片必须随「保存资料」一起落库。
 *
 * 背景（本次修复的契约）：照片不是普通文本字段——`ProfileFieldInputs` 按 `field_type`
 * 过滤掉了 `photo`，所以整页没有任何输入控件去注册
 * `sections.basic_info[0].values["basic_info.photo"]` 这条路径。而保存走的是
 * `form.validateFields()`，antd 的 validateFields **只回注册过的字段**：
 * 不注册 = 页面拿不到这个值 = 切换主照片只改本地草稿，重取 workspace 后回到旧照片，
 * 简历与导出也用旧图。
 *
 * 因此这里守的不是"某个组件长什么样"，而是那条不可见的数据契约：
 * ①隐藏 Form.Item 注册后 validateFields 能带回照片值；②该值真的进入本轮变更集。
 * 改前（没有那行隐藏 Form.Item）这个文件的第 1 条用例必然失败：
 * validateFields 的结果里 `values["basic_info.photo"]` 是 undefined。
 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, render } from "@testing-library/react";
import { useCallback, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfileBasicSection from "./ProfileBasicSection";
import { collectEntryChanges } from "../../features/profile/profileFormData";
import type { ProfileFormValues } from "../../features/profile-library/types";
import { makeAllSections, makeEntry, makeWorkspace } from "../../test/profileWorkspaceFixture";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const BASIC_INFO = makeAllSections().find((section) => section.key === "basic_info");
if (!BASIC_INFO) throw new Error("fixture 缺少 basic_info");

const OLD_PHOTO = "data:image/png;base64,T0xE";
const NEW_PHOTO = "data:image/png;base64,TkVX";

/** 照片字段的表单路径：与 ProfileBasicSection 里注册的隐藏 Form.Item 逐字一致。 */
const PHOTO_PATH: ["sections", string, number, "values", string] = [
  "sections",
  "basic_info",
  0,
  "values",
  "basic_info.photo",
];

/**
 * 表单实例只能由 `Form.useForm` 创建：用一层包装组件在 effect 里把它回传给用例。
 * `initialValues` 里带上姓名（basic_info.name 有必填规则），让 validateFields 只
 * 校验我们关心的照片路径。
 */
function Harness({
  onReady,
  initialValues,
}: {
  onReady: (form: FormInstance<ProfileFormValues>) => void;
  initialValues: ProfileFormValues;
}) {
  const [form] = Form.useForm<ProfileFormValues>();
  const handleReady = useCallback(() => {
    onReady(form);
  }, [form, onReady]);
  useEffect(() => {
    handleReady();
  }, [handleReady]);
  return (
    <AntdApp>
      <Form form={form} initialValues={initialValues}>
        <ProfileBasicSection
          section={BASIC_INFO}
          photo=""
          editing
          saving={false}
          onPhotoSelect={vi.fn()}
          onSetPreference={vi.fn()}
        />
      </Form>
    </AntdApp>
  );
}

const INITIAL_VALUES: ProfileFormValues = {
  sections: {
    basic_info: [{ entry_key: "entry-1", values: { "basic_info.name": "Alice" } }],
  },
};

function renderHarness(): FormInstance<ProfileFormValues> {
  const holder: { form: FormInstance<ProfileFormValues> | null } = { form: null };
  render(
    <Harness
      initialValues={INITIAL_VALUES}
      onReady={(form) => {
        holder.form = form;
      }}
    />,
  );
  if (!holder.form) throw new Error("表单实例未就绪");
  return holder.form;
}

describe("ProfileBasicSection 主照片的保存契约", () => {
  // 改前这里必然失败：照片字段没注册 → validateFields 不返回该路径 → undefined。
  it("照片路径已注册：切换后的主照片出现在 validateFields 的结果里", async () => {
    const form = renderHarness();

    form.setFieldValue(PHOTO_PATH, NEW_PHOTO);
    const values = await form.validateFields();

    // validateFields 只回注册过的字段：这一条就是"照片随资料保存"的最小证据。
    expect(values.sections.basic_info[0].values["basic_info.photo"]).toBe(NEW_PHOTO);
    // 同一个条目其余已注册字段仍在（照片注册没有挤掉别的东西）。
    expect(values.sections.basic_info[0].entry_key).toBe("entry-1");
    expect(values.sections.basic_info[0].values["basic_info.name"]).toBe("Alice");
  });

  it("切换后的主照片进入本轮变更集（保存请求会带上它）", async () => {
    const workspace = makeWorkspace({
      entries: [
        makeEntry("basic_info", "entry-1", {
          "basic_info.name": "Alice",
          "basic_info.photo": OLD_PHOTO,
        }),
      ],
    });
    const form = renderHarness();

    form.setFieldValue(PHOTO_PATH, NEW_PHOTO);
    const values = await form.validateFields();
    const changes = collectEntryChanges(workspace, values);

    const basicInfoChange = changes.find((item) => item.section_key === "basic_info");
    expect(basicInfoChange).toBeDefined();
    // 已有条目按 entry_id 对齐，只提交变化的 field_id。
    expect(basicInfoChange?.entry_id).toBe("entry-1");
    expect(basicInfoChange?.values["basic_info.photo"]).toBe(NEW_PHOTO);
    // 未改动的姓名不进变更集（照片注册不该把整条变成"全都变了"）。
    expect(basicInfoChange?.values["basic_info.name"]).toBeUndefined();
  });
});

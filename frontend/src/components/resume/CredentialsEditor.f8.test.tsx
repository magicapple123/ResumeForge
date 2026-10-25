// SPDX-License-Identifier: Apache-2.0
/** F8-C：证书资质新增「证书类型」字段（空条目注册 + 输入可写）。 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import CredentialsEditor from "./CredentialsEditor";

function setup() {
  const instance: { current: FormInstance | null } = { current: null };
  function Harness() {
    const [form] = Form.useForm();
    useEffect(() => {
      instance.current = form;
    }, [form]);
    return (
      <AntdApp>
        <Form form={form}>
          <CredentialsEditor />
        </Form>
      </AntdApp>
    );
  }
  render(<Harness />);
  return {
    get form(): FormInstance {
      if (!instance.current) throw new Error("form instance not ready");
      return instance.current;
    },
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("F8-C 证书资质新字段", () => {
  it("空条目带证书类型，输入写进表单", () => {
    const { form } = setup();
    fireEvent.click(
      screen.getByRole("button", {
        name: (name: string) => name.endsWith("添加" + t("editor.tab.credentials")),
      }),
    );
    expect(form.getFieldValue(["credentials", 0])).toMatchObject({ credential_type: "" });

    fireEvent.change(screen.getByLabelText(t("credentials.credential.credentialType")), {
      target: { value: "职业资格" },
    });
    expect(form.getFieldValue(["credentials", 0, "credential_type"])).toBe("职业资格");
  });
});

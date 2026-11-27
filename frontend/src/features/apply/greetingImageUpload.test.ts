// SPDX-License-Identifier: Apache-2.0
/**
 * 上传前的两道闸（格式 / 体积）。
 *
 * 这些用例钉的是一条"否定式"验收：**不许**因为 `accept="image/*"` 给了个假象就放行
 * 改名文件或超大图。粘贴与拖拽都绕不过这里，所以判定必须自己站得住。
 */
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { formatBytes } from "../../utils/format";
import { greetingImageExtension, validateGreetingImageFile } from "./greetingImageUpload";

const MB = 1024 * 1024;

function fileNamed(size: number, name: string, type: string): File {
  const blob = new File([new Uint8Array(1)], name, { type });
  // `size` 是 Blob 上的只读 getter：实例级覆盖即可造出"12 MB"而不必真分配 12 MB。
  Object.defineProperty(blob, "size", { value: size });
  return blob;
}

describe("greetingImageExtension", () => {
  it("取小写扩展名", () => {
    expect(greetingImageExtension("Shot.PNG")).toBe("png");
    expect(greetingImageExtension(".hidden.png")).toBe("png");
  });

  it("没有扩展名时回空串（不是整串文件名）", () => {
    expect(greetingImageExtension("screenshot")).toBe("");
    expect(greetingImageExtension("trailing.")).toBe("");
    expect(greetingImageExtension(".png")).toBe("");
  });
});

describe("validateGreetingImageFile", () => {
  const limit = 2 * MB;

  it("PNG / JPG / WebP / GIF 通过", () => {
    for (const [name, type] of [
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.jpeg", "image/jpeg"],
      ["a.webp", "image/webp"],
      ["a.gif", "image/gif"],
    ]) {
      expect(validateGreetingImageFile(fileNamed(1024, name, type), limit)).toBeNull();
    }
  });

  it("MIME 给不出来时以扩展名为准（部分系统会给空串）", () => {
    expect(validateGreetingImageFile(fileNamed(1024, "a.png", ""), limit)).toBeNull();
    expect(
      validateGreetingImageFile(fileNamed(1024, "a.jpg", "application/octet-stream"), limit),
    ).toBeNull();
  });

  it("扩展名不是图片：拒绝，并说清是哪个文件", () => {
    const rejection = validateGreetingImageFile(
      fileNamed(1024, "简历.pdf", "application/pdf"),
      limit,
    );
    expect(rejection?.code).toBe("not-image");
    expect(rejection?.message).toBe(t("applyQueue.image.rejectNotImage", { name: "简历.pdf" }));
  });

  it("后缀改成 .png 也骗不过：MIME 不在白名单同样拒绝", () => {
    const rejection = validateGreetingImageFile(
      fileNamed(1024, "invoice.png", "application/pdf"),
      limit,
    );
    expect(rejection?.code).toBe("not-image");
  });

  it("超过上限：上传前拦下，写明体积与上限", () => {
    const rejection = validateGreetingImageFile(
      fileNamed(12.3 * MB, "huge.png", "image/png"),
      limit,
    );
    expect(rejection?.code).toBe("too-large");
    expect(rejection?.message).toBe(
      t("applyQueue.image.rejectTooLarge", {
        name: "huge.png",
        size: formatBytes(12.3 * MB),
        limit: formatBytes(limit),
      }),
    );
    // 用户要能一眼看出"超了多少"，只写"超过上限"等于没说。
    expect(rejection?.message).toContain("12.3 MB");
    expect(rejection?.message).toContain("2.0 MB");
  });

  it("刚好等于上限算通过（边界不误杀）", () => {
    expect(validateGreetingImageFile(fileNamed(limit, "edge.png", "image/png"), limit)).toBeNull();
  });

  it("空文件拒绝：传给后端也只会返回 400", () => {
    const rejection = validateGreetingImageFile(fileNamed(0, "empty.png", "image/png"), limit);
    expect(rejection?.code).toBe("empty");
  });
});

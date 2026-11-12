// SPDX-License-Identifier: Apache-2.0
/**
 * `annotations.json` v1 解析器测试（契约 wave3 §4.2 / §4.4 第 3–4 步的格式面）。
 *
 * 回传文件来自外部，解析器必须**永不抛异常、永不半通过**：任何一个字段不合法都返回
 * 结构化原因（含条目标号/字段名），UI 据此一次列全问题。
 */
import { describe, expect, it } from "vitest";
import {
  REVIEW_ANNOTATIONS_MAX,
  REVIEW_PACK_KIND,
  REVIEW_PACK_MAX_BYTES,
  REVIEW_PACK_VERSION,
  type ReviewPackAnnotation,
} from "./types";
import { buildReviewPack, parseReviewPack, serializeReviewPack } from "./pack";

const TOKEN = "0123456789abcdef0123456789abcdef";
const SNAPSHOT = "b".repeat(64);
const OBJECT_ID = "ob_aaaaaaaaaaaa";

function annotation(overrides: Partial<ReviewPackAnnotation> = {}): ReviewPackAnnotation {
  return {
    external_id: "ext-001",
    object_id: OBJECT_ID,
    text: "这段经历的时间需要核对",
    ...overrides,
  };
}

function pack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format_version: REVIEW_PACK_VERSION,
    kind: REVIEW_PACK_KIND,
    share_token: TOKEN,
    package_snapshot_sha256: SNAPSHOT,
    reviewer: "李老师",
    created_at: "2026-10-24T10:00:00Z",
    annotations: [annotation()],
    ...overrides,
  };
}

function parse(value: Record<string, unknown>) {
  return parseReviewPack(JSON.stringify(value));
}

describe("合法包", () => {
  it("最小合法包通过并规范化字段", () => {
    const result = parse(pack());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.format_version).toBe(1);
    expect(result.pack.kind).toBe(REVIEW_PACK_KIND);
    expect(result.pack.annotations).toHaveLength(1);
    expect(result.pack.annotations[0]).toMatchObject({
      external_id: "ext-001",
      object_id: OBJECT_ID,
      text: "这段经历的时间需要核对",
    });
  });

  it("构建 → 序列化 → 解析往返一致（字段顺序稳定，便于人工查看）", () => {
    const built = buildReviewPack({
      shareToken: TOKEN,
      packageSnapshotSha256: SNAPSHOT,
      reviewer: "李老师",
      createdAt: "2026-10-24T10:00:00Z",
      annotations: [
        annotation(),
        annotation({
          external_id: "ext-002",
          object_id: undefined,
          path: "projects.0.name",
          quoted_text: "项目甲",
        }),
      ],
    });
    const text = serializeReviewPack(built);
    expect(text).toContain('"format_version": 1');
    const again = parseReviewPack(text);
    expect(again).toEqual({ ok: true, pack: built });
  });

  it("path 兼容锚点（无 object_id）也可以单独成立", () => {
    const result = parse(
      pack({ annotations: [annotation({ object_id: undefined, path: "projects.0.name" })] }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("整包级 fail-closed", () => {
  it("非 JSON / 空内容 → not-json", () => {
    expect(parseReviewPack("{not json")).toEqual({ ok: false, issues: [{ code: "not-json" }] });
    expect(parseReviewPack("   ")).toEqual({ ok: false, issues: [{ code: "not-json" }] });
  });

  it("未知版本 / 未知 kind → 整包拒绝（不猜新字段）", () => {
    const version = parse(pack({ format_version: 2 }));
    expect(version.ok).toBe(false);
    if (!version.ok) expect(version.issues).toContainEqual({ code: "bad-version" });
    const kind = parse(pack({ kind: "something.else" }));
    expect(kind.ok).toBe(false);
    if (!kind.ok) expect(kind.issues).toContainEqual({ code: "bad-format" });
  });

  it("share_token 必须是 32 位十六进制、快照哈希必须存在", () => {
    const token = parse(pack({ share_token: "short" }));
    expect(token.ok).toBe(false);
    if (!token.ok) expect(token.issues).toContainEqual({ code: "bad-token" });
    const snapshot = parse(pack({ package_snapshot_sha256: "" }));
    expect(snapshot.ok).toBe(false);
    if (!snapshot.ok) expect(snapshot.issues).toContainEqual({ code: "bad-snapshot" });
  });

  it("超过 512 KiB → too-large", () => {
    const huge = pack({ reviewer: "x".repeat(REVIEW_PACK_MAX_BYTES) });
    const result = parseReviewPack(JSON.stringify(huge));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toEqual({ code: "too-large" });
  });

  it("批注超过 500 条 → bad-annotations", () => {
    const result = parse(
      pack({
        annotations: Array.from({ length: REVIEW_ANNOTATIONS_MAX + 1 }, (_, index) =>
          annotation({ external_id: `ext-${index}` }),
        ),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ code: "bad-annotations" });
  });
});

describe("逐条校验（外部文本不可信）", () => {
  function issuesOf(badAnnotation: Record<string, unknown>) {
    const result = parse(pack({ annotations: [badAnnotation] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("应当失败");
    return result.issues;
  }

  it("external_id 空/超长、正文空/超长、引用超长都指出字段名", () => {
    expect(issuesOf({ external_id: "", object_id: OBJECT_ID, text: "x" })).toContainEqual({
      code: "bad-annotation",
      index: 0,
      field: "external_id",
    });
    expect(
      issuesOf({ external_id: "x".repeat(65), object_id: OBJECT_ID, text: "x" }),
    ).toContainEqual({ code: "bad-annotation", index: 0, field: "external_id" });
    expect(issuesOf({ external_id: "ext", object_id: OBJECT_ID, text: "   " })).toContainEqual({
      code: "bad-annotation",
      index: 0,
      field: "text",
    });
    expect(
      issuesOf({ external_id: "ext", object_id: OBJECT_ID, text: "x".repeat(2001) }),
    ).toContainEqual({ code: "bad-annotation", index: 0, field: "text" });
    expect(
      issuesOf({
        external_id: "ext",
        object_id: OBJECT_ID,
        text: "x",
        quoted_text: "q".repeat(201),
      }),
    ).toContainEqual({ code: "bad-annotation", index: 0, field: "quoted_text" });
  });

  it("必须至少有一个锚点：object_id 或 path", () => {
    expect(issuesOf({ external_id: "ext", text: "没有锚点" })).toContainEqual({
      code: "bad-annotation",
      index: 0,
      field: "object_id",
    });
  });

  it("非法 object_id / point_id / path 被拒绝（不把坏身份写进库）", () => {
    expect(issuesOf({ external_id: "ext", object_id: "bad id", text: "x" })).toContainEqual({
      code: "bad-annotation",
      index: 0,
      field: "object_id",
    });
    expect(
      issuesOf({ external_id: "ext", object_id: OBJECT_ID, point_id: "pt", text: "x" }),
    ).toContainEqual({ code: "bad-annotation", index: 0, field: "point_id" });
    expect(issuesOf({ external_id: "ext", path: 'projects.0"] {', text: "x" })).toContainEqual({
      code: "bad-annotation",
      index: 0,
      field: "path",
    });
  });

  it("包内 external_id 重复 → duplicate-external-id（去重键必须唯一）", () => {
    const result = parse(pack({ annotations: [annotation(), annotation({ text: "第二条" })] }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues).toContainEqual({ code: "duplicate-external-id", index: 1 });
  });

  it("多条坏批注一次列全（不遇到第一条就停）", () => {
    const result = parse(
      pack({
        annotations: [
          { external_id: "ext-1", text: "ok" },
          { external_id: "ext-2", object_id: OBJECT_ID, text: "ok" },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        code: "bad-annotation",
        index: 0,
        field: "object_id",
      });
      expect(result.issues).toHaveLength(1);
    }
  });
});

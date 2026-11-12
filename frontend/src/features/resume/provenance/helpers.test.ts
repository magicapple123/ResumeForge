// SPDX-License-Identifier: Apache-2.0
/** W12-FE 纯规则：未关联/stale 过滤、选中匹配、候选状态、冲突分类、未知 token 表达。 */
import { describe, expect, it } from "vitest";
import {
  asFactLockConflict,
  conflictKind,
  costAmount,
  coverageUnlinked,
  durationText,
  factLockViolationsFromError,
  hasUnknownTokens,
  initialCandidateStates,
  latestRevision,
  locksForSelection,
  objectsForSelection,
  shortFingerprint,
  sourceKindKey,
  staleLinks,
  tokenText,
  unlinkedObjects,
  withCandidateState,
} from "./helpers";
import type {
  BlockLinkOut,
  DocumentObjectOut,
  FactLockOut,
  ResumeProvenanceOut,
  SourceOut,
  UsageBucketOut,
  UsageCostOut,
} from "./types";

function link(overrides: Partial<BlockLinkOut> = {}): BlockLinkOut {
  return {
    link_id: 1,
    source_id: 2,
    object_id: "exp_1",
    point_id: null,
    path: "experience.0.description.0",
    field: "description",
    source_fingerprint: "aaa",
    status: "linked",
    ...overrides,
  };
}

function source(overrides: Partial<SourceOut> = {}): SourceOut {
  return {
    id: 2,
    kind: "claim",
    external_ref: "claim_record:12",
    title: "Led checkout rewrite",
    current_fingerprint: "ffffffffffff",
    latest_revision_no: 3,
    revisions: [
      { revision_no: 1, fingerprint: "aaa", summary: "first", captured_at: null },
      { revision_no: 3, fingerprint: "fff", summary: "third", captured_at: null },
      { revision_no: 2, fingerprint: "bbb", summary: "second", captured_at: null },
    ],
    blocks: [],
    ...overrides,
  };
}

function object(overrides: Partial<DocumentObjectOut> = {}): DocumentObjectOut {
  return {
    path: "experience.0.description.0",
    field: "description",
    object_id: "exp_1",
    point_id: null,
    label: "Experience",
    link: null,
    ...overrides,
  };
}

function provenance(objects: DocumentObjectOut[]): ResumeProvenanceOut {
  return {
    resume_id: 3,
    revision: 7,
    sources: [source()],
    objects,
    unresolved_links: [],
    coverage: { total: objects.length, linked: objects.filter((o) => o.link).length, unlinked: 0 },
  };
}

describe("来源展示派生", () => {
  it("来源类型映射到文案 key，未知类型按手工登记", () => {
    expect(sourceKindKey("claim")).toBe("provenance.source.kind.claim");
    expect(sourceKindKey("bogus")).toBe("provenance.source.kind.manual");
  });

  it("最新修订按 revision_no 取最大，空列表返回 null", () => {
    expect(latestRevision(source())?.revision_no).toBe(3);
    expect(latestRevision(source({ revisions: [] }))).toBeNull();
  });

  it("指纹短显示只截前 8 位", () => {
    expect(shortFingerprint("0123456789abcdef")).toBe("01234567…");
    expect(shortFingerprint("abc")).toBe("abc");
  });

  it("未关联与 stale 各自过滤，不混在一起", () => {
    const data = provenance([
      object({ object_id: "a", link: null }),
      object({ object_id: "b", link: link({ object_id: "b", status: "stale" }) }),
      object({ object_id: "c", link: link({ object_id: "c", status: "linked" }) }),
    ]);
    expect(unlinkedObjects(data).map((o) => o.object_id)).toEqual(["a"]);
    expect(staleLinks(data).map((l) => l.object_id)).toEqual(["b"]);
  });

  it("按 object_id / point_id / path 依次匹配选中块", () => {
    const data = provenance([
      object({ object_id: "a", path: "p.a" }),
      object({ object_id: "b", point_id: "pt_b", path: "p.b" }),
    ]);
    expect(objectsForSelection(data, { object_id: "a" }).map((o) => o.object_id)).toEqual(["a"]);
    expect(objectsForSelection(data, { point_id: "pt_b" })[0].path).toBe("p.b");
    expect(objectsForSelection(data, { path: "p.a" }).map((o) => o.object_id)).toEqual(["a"]);
    expect(objectsForSelection(data, {})).toEqual([]);
    expect(objectsForSelection(null, { object_id: "a" })).toEqual([]);
  });

  it("coverage 未关联数优先用服务端值", () => {
    expect(coverageUnlinked({ total: 10, linked: 4, unlinked: 6 })).toBe(6);
    expect(coverageUnlinked({ total: 10, linked: 4, unlinked: 0 })).toBe(0);
    expect(coverageUnlinked(null)).toBe(0);
  });
});

describe("候选状态", () => {
  it("初始三条 idle，按模式更新不影响其它条", () => {
    const initial = initialCandidateStates(["concise", "method"]);
    expect(initial.map((s) => s.status)).toEqual(["idle", "idle"]);
    const next = withCandidateState(initial, "method", { status: "loading" });
    expect(next.map((s) => s.status)).toEqual(["idle", "loading"]);
    expect(initial[1].status).toBe("idle");
  });
});

describe("冲突与用量表达", () => {
  it("只有两种业务码被识别为可解释冲突", () => {
    expect(conflictKind("fact_lock_conflict")).toBe("fact_lock");
    expect(conflictKind("resume_revision_conflict")).toBe("revision");
    expect(conflictKind("other")).toBe("other");
    expect(conflictKind(undefined)).toBe("other");
  });

  it("事实锁冲突体收窄（形状不对就返回 null）", () => {
    expect(asFactLockConflict({ code: "fact_lock_conflict", violations: [] })).not.toBeNull();
    expect(asFactLockConflict({ code: "x", violations: [] })).toBeNull();
    expect(asFactLockConflict(null)).toBeNull();
  });

  it("逐条违规从 ApiError.payload 读取；缺失/畸形一律空数组且不抛", () => {
    const violation = {
      lock_id: 1,
      kind: "institution",
      label: "公司名",
      path: "experience.0.company",
      field: "company",
      reason: "changed",
      locked_value: "Cloud Commerce Ltd",
      current_value: "Cloud Commerce Limited",
    };
    expect(
      factLockViolationsFromError({
        payload: { code: "fact_lock_conflict", violations: [violation] },
      }),
    ).toHaveLength(1);
    // payload 缺失（旧客户端 / 非 409）
    expect(factLockViolationsFromError(new Error("boom"))).toEqual([]);
    expect(factLockViolationsFromError(null)).toEqual([]);
    expect(factLockViolationsFromError(undefined)).toEqual([]);
    // payload 存在但不是事实锁冲突形状
    expect(factLockViolationsFromError({ payload: { detail: "x" } })).toEqual([]);
    expect(factLockViolationsFromError({ payload: { code: "fact_lock_conflict" } })).toEqual([]);
  });

  it("token 未知返回 null 而不是 0；耗时按 1s 分档", () => {
    expect(tokenText(null)).toBeNull();
    expect(tokenText(0)).toBe("0");
    expect(tokenText(1200)).toBe("1200");
    expect(durationText(950)).toBe("950 ms");
    expect(durationText(1500)).toBe("1.5 s");
    expect(durationText(null)).toBeNull();
  });

  it("存在未知 token 的桶 / 费用未估算时不给数字", () => {
    const unknown: UsageBucketOut = {
      key: "t",
      calls: 1,
      retries: 0,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      duration_ms: null,
      unknown_token_calls: 1,
    };
    expect(hasUnknownTokens(unknown)).toBe(true);
    expect(hasUnknownTokens({ ...unknown, total_tokens: 5, unknown_token_calls: 0 })).toBe(false);
    const cost: UsageCostOut = { estimated: false, currency: "", amount: null, reason: "" };
    expect(costAmount(cost)).toBeNull();
    expect(costAmount({ ...cost, estimated: true, amount: 0.42 })).toBe(0.42);
  });
});

describe("事实锁选中匹配", () => {
  it("object_id 优先，退回 path", () => {
    const locks: FactLockOut[] = [
      {
        id: 1,
        resume_id: 3,
        kind: "name",
        object_id: "a",
        point_id: null,
        path: "p.a",
        field: "name",
        locked_value: "Lin",
        label: "",
        created_at: null,
      },
      {
        id: 2,
        resume_id: 3,
        kind: "time",
        object_id: null,
        point_id: null,
        path: "p.b",
        field: "start_date",
        locked_value: "2019.03",
        label: "",
        created_at: null,
      },
    ];
    expect(locksForSelection(locks, { object_id: "a" }).map((l) => l.id)).toEqual([1]);
    expect(locksForSelection(locks, { path: "p.b" }).map((l) => l.id)).toEqual([2]);
    expect(locksForSelection(locks, {})).toEqual([]);
  });
});

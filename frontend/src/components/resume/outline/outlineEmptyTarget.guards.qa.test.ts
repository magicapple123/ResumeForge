// SPDX-License-Identifier: Apache-2.0
/**
 * QA 独立验收（本轮新写，未复用工程师的任何用例）：**空要点字段占位行的边界与拒绝矩阵**，
 * 以及「原地确认不改字段」的**纯函数**证明。
 *
 * 分工：组件级用例在同目录 `OutlinePanel.emptyTargetRestore.qa.test.tsx`（"真机上真的拖得回去"），
 * 这里钉住"什么情况下**不该**出现占位行 / 不该接落点"——这些规则散在
 * `emptyPointFields`（该不该渲染）、`emptyFieldInsertIndex`（渲染在哪一行）、
 * `selectionForTreeKey` / `visibleTreeKeys`（键盘绕开它）、`classifyDropKey` /
 * `resolveHoverTarget` / `resolveDropPoint`（接不接落点）与 `pointMoveOf`（原地短路）五处。
 */
import { describe, expect, it } from "vitest";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import {
  buildOutline,
  entriesOf,
  entryIdOf,
  entryKey,
  pointIdsOf,
  type OutlineModel,
} from "../../../features/resume-outline/model";
import {
  emptyFieldInsertIndex,
  emptyPointFields,
  flatInsertionOf,
  pointMoveOf,
  type PointRef,
} from "../../../features/resume-outline/pointMove";
import type { OutlineSortSession } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import {
  classifyDropKey,
  dragStartIndex,
  parseTreeKey,
  resolveDropPoint,
  resolveHoverTarget,
  type DropRowBox,
} from "./outlineDropTargets";
import {
  emptyFieldTreeKey,
  entryKeyOfTreeKey,
  previewModel,
  selectionForTreeKey,
  sortSessionCommand,
  visibleTreeKeys,
} from "./outlineTree";
import type { OutlineDragPayload } from "./useOutlineSort";

const SCHOOL_A = "上海大学";
const SCHOOL_B = "复旦大学";
const AWARD_A = "奖学金";
const AWARD_B = "优秀学生";
const COURSE_A = "市场营销学";

function educationOf(
  school: string,
  courses: string[],
  achievements: string[],
  lockLayout = false,
) {
  return {
    school,
    major: "市场营销",
    degree: "本科",
    gpa: "",
    start_date: "",
    end_date: "",
    courses,
    achievements,
    ...(lockLayout ? { lock_layout: true } : {}),
  };
}

function projectOf(name: string, techStack: string[], description: string[], highlights: string[]) {
  return {
    name,
    role: "",
    start_date: "",
    end_date: "",
    tech_stack: techStack,
    description,
    highlights,
  };
}

/**
 * 两份要点字段都要覆盖到：
 * - E1：`courses` 已被搬空（单向门的终点状态），`achievements` 非空；
 * - E2：反向（`achievements` 空、`courses` 非空）；
 * - P1：三个要点字段全非空（**任何字段都不该出占位行**）；
 * - P2：`tech_stack` / `highlights` 空、`description` 3 条（占位行的插入位置 = 0 与 3）。
 */
function makeContent(): ResumeContent {
  const draft: ResumeContent = {
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [
      educationOf(SCHOOL_A, [], [AWARD_A, AWARD_B]),
      educationOf(SCHOOL_B, [COURSE_A], []),
    ],
    experience: [],
    campus_experience: [],
    projects: [
      projectOf("简历工具", ["React"], ["重构大纲", "补齐拖拽"], ["上线"]),
      projectOf("数据平台", [], ["建仓", "迁移", "灰度"], []),
    ],
    skills: [],
    awards: [],
  };
  return ensureIds(draft);
}

/** 只有一份教育经历、"课程"非空的形态（复现原地确认缺陷的最小数据）。 */
function noopContent(): ResumeContent {
  const draft: ResumeContent = {
    ...makeContent(),
    education: [educationOf(SCHOOL_A, [COURSE_A], [AWARD_A, AWARD_B])],
    projects: [],
  };
  return ensureIds(draft);
}

function sectionOf(model: OutlineModel, field: "education" | "projects") {
  const section = model.sections.find((item) => item.field === field);
  if (!section) throw new Error("missing section: " + field);
  return section;
}

/** 被拖要点：E1 的第二条成果（`achievements` 非空，`courses` 空）。 */
function payloadOf(content: ResumeContent, index = 0): OutlineDragPayload {
  const entry = entriesOf(content, "education")[index];
  return {
    kind: "point",
    field: "education",
    objectId: entryIdOf(entry),
    pointField: "achievements",
    pointId: pointIdsOf(entry, "achievements")[0],
  };
}

function boxOf(key: string, top: number, height = 28): DropRowBox {
  return { key, top, bottom: top + height, centerY: top + height / 2 };
}

describe("占位行该不该出现（emptyPointFields / emptyFieldInsertIndex）", () => {
  it("只给「已声明但一条要点都没有」的字段出占位行，且按字段声明顺序", () => {
    const model = buildOutline(makeContent());
    const education = sectionOf(model, "education").entries;
    // E1：课程空 → 只有 courses；成果非空 → 不给 achievements 出占位行。
    expect(emptyPointFields(education[0])).toEqual(["courses"]);
    // E2：反向——课程非空、成果空 → 只有 achievements。
    expect(emptyPointFields(education[1])).toEqual(["achievements"]);
    const projects = sectionOf(model, "projects").entries;
    // P1：三字段全非空 → 一个占位行都不该有（非空字段没有"搬回来"的需求）。
    expect(emptyPointFields(projects[0])).toEqual([]);
    // P2：声明顺序 tech_stack → description → highlights。
    expect(emptyPointFields(projects[1])).toEqual(["tech_stack", "highlights"]);
  });

  it("占位行的视觉位置 = 它前面那几个字段的要点总数", () => {
    const model = buildOutline(makeContent());
    const projects = sectionOf(model, "projects").entries;
    expect(emptyFieldInsertIndex(projects[1], "tech_stack")).toBe(0);
    // highlights 前面是 3 条 description（声明顺序里在它之前的字段）。
    expect(emptyFieldInsertIndex(projects[1], "highlights")).toBe(3);
    const education = sectionOf(model, "education").entries;
    expect(emptyFieldInsertIndex(education[0], "courses")).toBe(0);
    // achievements 前面有 1 条课程（E2 的 courses 非空）。
    expect(emptyFieldInsertIndex(education[1], "achievements")).toBe(1);
  });
});

describe("占位行的树键是「只给解析看」的：不可选中、不进可见键", () => {
  it("selectionForTreeKey / visibleTreeKeys / entryKeyOfTreeKey 都不认它", () => {
    const content = makeContent();
    const model = buildOutline(content);
    const objectId = entryIdOf(entriesOf(content, "education")[0]);
    const key = emptyFieldTreeKey("education", objectId, "courses");

    expect(key).toBe(`point-empty:education:${objectId}:courses`);
    // 只有 `parseTreeKey` 认它（拖放解析用），选择/焦点/键盘导航一律不认。
    expect(parseTreeKey(key)).toEqual({
      kind: "empty-point",
      field: "education",
      objectId,
      pointField: "courses",
    });
    expect(selectionForTreeKey(key)).toBeNull();
    expect(entryKeyOfTreeKey(key)).toBe("");

    const visible = visibleTreeKeys(
      model,
      new Set(["education", "projects"]),
      new Set([entryKey("education", objectId)]),
    );
    expect(visible.some((item) => item.startsWith("point-empty:"))).toBe(false);
    // E1 的 2 条成果要点仍在可见键里（占位行没有顶掉真实要点）。
    expect(visible.filter((item) => item.startsWith("point:"))).toHaveLength(2);
  });
});

describe("落点解析的拒绝矩阵（classifyDropKey）", () => {
  const content = makeContent();
  const model = buildOutline(content);
  const [e1, e2] = entriesOf(content, "education");
  const p1 = entriesOf(content, "projects")[0];
  const payload = payloadOf(content);
  const own = (pointField: string) => emptyFieldTreeKey("education", entryIdOf(e1), pointField);

  it("只接受「本条目的其它空字段占位行」", () => {
    expect(classifyDropKey(model, payload, own("courses"))).toEqual({
      kind: "field",
      pointField: "courses",
    });
  });

  it("同字段的占位行 / 别的条目的占位行 / 别的板块的占位行一律拒绝", () => {
    // 同字段：占位文本的意思是"搬进这个字段"，而它已经在里面了。
    expect(classifyDropKey(model, payload, own("achievements"))).toEqual({ kind: "reject" });
    // 别的条目：改另一条经历的内容不是"给这条排顺序"。
    expect(
      classifyDropKey(model, payload, emptyFieldTreeKey("education", entryIdOf(e2), "courses")),
    ).toEqual({ kind: "reject" });
    // 别的板块。
    expect(
      classifyDropKey(model, payload, emptyFieldTreeKey("projects", entryIdOf(p1), "tech_stack")),
    ).toEqual({ kind: "reject" });
  });

  it("条目拖动没有「搬进空字段」的语义；空键/个人信息/板块标题各自按规矩走", () => {
    expect(
      classifyDropKey(
        model,
        { kind: "entry", field: "education", objectId: entryIdOf(e1) },
        own("courses"),
      ),
    ).toEqual({ kind: "reject" });
    expect(classifyDropKey(model, payload, "")).toEqual({ kind: "geometry" });
    expect(classifyDropKey(model, payload, "personal")).toEqual({ kind: "reject" });
    expect(classifyDropKey(model, payload, "section:education")).toEqual({ kind: "geometry" });
  });
});

describe("几何落点（resolveHoverTarget / resolveDropPoint）", () => {
  const content = makeContent();
  const model = buildOutline(content);
  const [e1, e2] = entriesOf(content, "education");
  const payload = payloadOf(content);

  it("压在本条目的占位行上：悬停指出「不产生位移」的下标，松手落在该字段", () => {
    const own = boxOf(emptyFieldTreeKey("education", entryIdOf(e1), "courses"), 490);
    const start = dragStartIndex(model, payload);
    expect(resolveHoverTarget(model, payload, [own], 500, null)).toEqual({
      kind: "target",
      key: own.key,
      index: start,
    });
    expect(resolveDropPoint(model, payload, [own], 500)).toEqual({
      kind: "field",
      pointField: "courses",
    });
  });

  it("压在别的条目的占位行上：悬停维持现状、松手拒绝（顺序一动不动）", () => {
    const foreign = boxOf(emptyFieldTreeKey("education", entryIdOf(e2), "courses"), 490);
    expect(resolveHoverTarget(model, payload, [foreign], 500, null)).toEqual({ kind: "keep" });
    expect(resolveDropPoint(model, payload, [foreign], 500)).toEqual({ kind: "reject" });
  });

  it("缝隙 / 没有坐标一律不猜：悬停不动，松手提交拖动中看到的那一版", () => {
    const own = boxOf(emptyFieldTreeKey("education", entryIdOf(e1), "courses"), 490);
    expect(resolveHoverTarget(model, payload, [own], 1000, null)).toEqual({ kind: "keep" });
    expect(resolveDropPoint(model, payload, [own], 1000)).toEqual({ kind: "commit" });
    expect(resolveHoverTarget(model, payload, [own], Number.NaN, null)).toEqual({ kind: "keep" });
    expect(resolveDropPoint(model, payload, [own], Number.NaN)).toEqual({ kind: "commit" });
  });
});

describe("原地确认不改字段（pointMoveOf 的短路）", () => {
  const content = noopContent();
  const model = buildOutline(content);
  const entry = sectionOf(model, "education").entries[0];
  const points: PointRef[] = entry.points.map((point) => ({
    pointField: point.pointField,
    pointId: point.pointId,
  }));
  const objectId = entry.objectId;

  function sessionOf(pointField: string, pointId: string, startIndex: number): OutlineSortSession {
    return {
      kind: "point",
      field: "education",
      objectId,
      pointField,
      pointId,
      startIndex,
      currentIndex: startIndex,
      total: points.length,
    };
  }

  it("顺手记下数据形状：扁平列表 = [课程 0, 成果 0, 成果 1]", () => {
    expect(points.map((point) => point.pointField)).toEqual([
      "courses",
      "achievements",
      "achievements",
    ]);
  });

  it("反证：底层 flatInsertionOf(points, from, from) 确实会算成「位置不变、字段变成相邻字段」", () => {
    // 这就是修复前的缺陷来源——短路必须由 pointMoveOf 负责，不能指望底层插入推导。
    expect(flatInsertionOf(points, 0, 0)).toEqual({
      targetField: "achievements",
      fieldIndex: 0,
      flatIndex: 0,
    });
  });

  it("课程第一条原地确认：同字段 + 本组内下标 0，命令落回 reorder-point 且 changed:false", () => {
    const session = sessionOf("courses", points[0].pointId, 0);
    expect(
      pointMoveOf(points, {
        pointField: "courses",
        pointId: points[0].pointId,
        startIndex: 0,
        currentIndex: 0,
      }),
    ).toEqual({
      fromPointField: "courses",
      toPointField: "courses",
      toIndex: 0,
      sameField: true,
    });

    const command = sortSessionCommand(session, points);
    expect(command).toMatchObject({
      type: "reorder-point",
      field: "education",
      pointField: "courses",
      toIndex: 0,
    });
    const applied = applyOutlineCommand(content, command);
    expect(applied).toMatchObject({ ok: true, changed: false });
    // 内容逐字段不动：课程行不会凭空消失。
    expect(JSON.stringify(applied.ok ? applied.content : null)).toBe(JSON.stringify(content));
  });

  it("最后一组要点的原地确认同样是 no-op（本组内下标 = 1，不是扁平下标 2）", () => {
    const session = sessionOf("achievements", points[2].pointId, 2);
    const command = sortSessionCommand(session, points);
    expect(command).toMatchObject({ type: "reorder-point", toIndex: 1 });
    expect(applyOutlineCommand(content, command)).toMatchObject({ ok: true, changed: false });
  });

  it("预览与命令同口径：currentIndex === startIndex 时预览模型逐字段等于基准模型", () => {
    const session = sessionOf("courses", points[0].pointId, 0);
    expect(JSON.stringify(previewModel(model, session))).toBe(JSON.stringify(model));
  });

  it("对照：真的按了一次方向键（currentIndex = 1）仍然跨字段搬移，短路没杀掉正常手势", () => {
    const session = { ...sessionOf("courses", points[0].pointId, 0), currentIndex: 1 };
    const command = sortSessionCommand(session, points);
    expect(command).toMatchObject({
      type: "move-point",
      fromPointField: "courses",
      toPointField: "achievements",
      toIndex: 1,
    });
    const applied = applyOutlineCommand(content, command);
    expect(applied).toMatchObject({ ok: true, changed: true });
  });
});

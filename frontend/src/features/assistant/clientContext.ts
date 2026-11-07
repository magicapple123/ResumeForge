// SPDX-License-Identifier: Apache-2.0
/**
 * T25 共享应用状态：把当前 `location.pathname` + `location.search` 变成随聊天请求发出的
 * 界面上下文。
 *
 * 四条纪律（后端在 `api/assistant_client_context.py` 里按同样口径复核）：
 * 1. **只送结构化标识**：route / view / selected{type,id}，不送标题、不送页面正文——
 *    标题由后端按当前数据集重查，前端给了也不采信；
 * 2. **selected 只从两处确定性提取**：路径里的数字 id（如 `/jobs/12` → job 12），或
 *    **按路由登记过的查询参数白名单**（`SELECTION_QUERY_PARAMS`，例如 `/jobs?job_id=12`）。
 *    白名单之外的路由/参数一律不猜，id 不是正整数就不猜，宁可只传 route；
 * 3. **查询串不进入 route 字段**：`route` 始终是纯路径（后端 `ROUTE_PATTERN` 会丢弃带
 *    `?` 的值），查询串只用于查白名单，绝不整体上送；
 * 4. **路径形状不合后端白名单时整个上下文不传**（`ROUTE_SHAPE`：`^/[A-Za-z0-9/_-]*$`），
 *    避免把任意文本塞进系统提示。未知页面只传 route，view 留空串（后端见空串不注入）。
 */
import type { AssistantClientContext, AssistantClientSelectionType } from "../../api/assistant";

/** 已登记页面（与 `appRoutes.tsx` 的静态路由一一对应）：路径 → 稳定视图标识。 */
const VIEW_BY_ROUTE: Record<string, string> = {
  "/": "home",
  "/jobs": "jobs",
  "/resumes": "resumes",
  "/apply": "apply",
  "/webform": "webform",
  "/tracker": "tracker",
  "/analytics": "analytics",
  "/favorites": "favorites",
  "/assistant": "assistant",
  "/materials": "materials",
  "/knowledge": "knowledge",
  "/skills": "skills",
  "/interview": "interview",
  "/profile": "profile",
  "/claims": "claims",
  "/claims/drill": "claims_drill",
  "/trash": "trash",
  "/settings": "settings",
};

/**
 * 查询串白名单：**精确路径 → 一个参数名 + 一个选中类型**。
 *
 * 为什么需要它：路由表全是静态页，岗位/简历的明细是抽屉 + `?job_id=`（例如
 * `JobsPage.tsx` 打开抽屉时写 `?job_id=N`、`ResumesPage.tsx` 写 `?resume_id=N`），
 * 所以路径段里永远没有 id，selected 会一直是 undefined——助手就答不出"这个岗位"。
 *
 * **扩展规则**（新增一条前先确认三件事）：
 * 1. 该参数确实代表"用户当前正在看的那一条"（详情抽屉/详情视图），不是筛选条件；
 * 2. 键必须是**精确路径**（`/jobs`，不带尾斜杠——`normalizeRoute` 已折叠），值里的
 *    `type` 必须与后端 `SELECTION_MODELS` 白名单逐字对应；
 * 3. 只登记页面实际会写的那一个参数。**不要把筛选参数混进来**：`/resumes?job_id=12`
 *    是"按岗位筛简历"，用户选中的是简历列表而不是那条岗位，映射成 job 会让助手
 *    对着错误的对象说话；`/jobs?keyword=` 这类同理。
 */
const SELECTION_QUERY_PARAMS: Record<
  string,
  { readonly param: string; readonly type: AssistantClientSelectionType }
> = {
  // 岗位页的详情抽屉：`?job_id=N` 表示"当前打开的是这条岗位"。
  "/jobs": { param: "job_id", type: "job" },
  // 简历页的详情抽屉：`?resume_id=N` 表示"当前打开的是这份简历"。
  "/resumes": { param: "resume_id", type: "resume" },
};

/**
 * 集合路径段 → `selected.type`：明细页的 id 段紧跟在集合段后面。
 * 当前路由表还没有这些动态路由（岗位/简历明细走抽屉 + `?job_id=`，由上面的查询串
 * 白名单处理），但解析规则写在这里是为了深链一旦加上就自动生效；类型名与后端
 * `SELECTION_MODELS` 白名单逐字对应。
 */
const SELECTION_TYPE_BY_COLLECTION: Record<string, AssistantClientSelectionType> = {
  jobs: "job",
  resumes: "resume",
  materials: "material",
  claims: "claim",
  knowledge: "knowledge",
  tracker: "tracker",
  reminders: "reminder",
  "interview-experiences": "interview_experience",
};

/** 后端 `ROUTE_PATTERN` 的本地镜像。 */
const ROUTE_SHAPE = /^\/[A-Za-z0-9/_-]*$/;
const MAX_ROUTE_LENGTH = 120;

/** 归一化路径：折叠尾斜杠；形状不合规或超长返回 null（调用方据此整个不传）。 */
function normalizeRoute(pathname: string): string | null {
  const trimmed = (pathname || "").trim();
  if (!trimmed || trimmed.length > MAX_ROUTE_LENGTH) return null;
  const collapsed = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
  const route = collapsed || "/";
  return ROUTE_SHAPE.test(route) ? route : null;
}

/** 路径里的数字 id：`/jobs/12` → `{type:"job", id:12}`；不是正整数就不猜。 */
function selectionFromRoute(route: string): AssistantClientContext["selected"] {
  const segments = route.split("/").filter(Boolean);
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    if (!/^\d+$/.test(segment)) continue;
    const id = Number(segment);
    if (!Number.isInteger(id) || id < 1) continue;
    const type = SELECTION_TYPE_BY_COLLECTION[segments[index - 1] ?? ""];
    if (type) return { type, id };
  }
  return undefined;
}

/** 查询串里的正整数 id；缺参、非纯数字、0 与负数都不猜（与路径段同一判据）。 */
function positiveIdFromParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const id = Number(trimmed);
  return Number.isInteger(id) && id >= 1 ? id : undefined;
}

/**
 * 查询串白名单里的选中项：`/jobs?job_id=12` → `{type:"job", id:12}`。
 *
 * `route` 必须是**精确登记路径**（`/jobs`，不是 `/jobs/12` 也不是 `/jobs/`），否则返回
 * undefined——白名单按页面登记，不按前缀继承。`search` 可带可不带开头的 `?`。
 */
function selectionFromQuery(route: string, search: string): AssistantClientContext["selected"] {
  const spec = SELECTION_QUERY_PARAMS[route];
  if (!spec) return undefined;
  const trimmed = (search || "").trim().replace(/^\?/, "");
  if (!trimmed) return undefined;
  const params = new URLSearchParams(trimmed);
  const id = positiveIdFromParam(params, spec.param);
  if (id === undefined) return undefined;
  return { type: spec.type, id };
}

/** 视图标识：静态路由精确命中优先；明细页回落到其集合页的视图；未知页面留空。 */
function viewForRoute(route: string): string {
  const exact = VIEW_BY_ROUTE[route];
  if (exact) return exact;
  const collection = SELECTION_TYPE_BY_COLLECTION[route.split("/").filter(Boolean)[0] ?? ""];
  if (!collection) return "";
  return VIEW_BY_ROUTE["/" + (route.split("/").filter(Boolean)[0] ?? "")] ?? "";
}

/**
 * 生成随聊天消息发送的界面上下文。
 *
 * @param pathname 当前 `window.location.pathname`（调用方传，便于单测）；**不含**查询串。
 * @param search 当前 `window.location.search`（可带 `?`）；只用于查白名单参数，绝不进入
 *     `route` 字段。不传等价于"没有查询串"。
 * @returns 路径形状不合规时返回 undefined（不发送该字段）；否则至少含 route 与 view。
 */
export function buildAssistantClientContext(
  pathname: string,
  search: string = "",
): AssistantClientContext | undefined {
  const route = normalizeRoute(pathname);
  if (route === null) return undefined;
  // 路径段优先（深链 `/jobs/12`），其次才看白名单里的查询参数（抽屉 `?job_id=12`）。
  const selected = selectionFromRoute(route) ?? selectionFromQuery(route, search);
  const context: AssistantClientContext = { route, view: viewForRoute(route) };
  if (selected) context.selected = selected;
  return context;
}

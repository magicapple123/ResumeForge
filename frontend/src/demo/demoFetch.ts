/**
 * 在线体验模式（demo mode）的请求拦截层。
 *
 * ## 为什么是「打补丁 window.fetch」而不是别的方案
 *
 * 这个应用所有的后端调用最终都落到 `fetch` 上——`api/client.ts` 的 `request()`、
 * `api/stream.ts` 的 `consumeSSE()`，以及若干处读文件流/圆图的裸 `fetch`。
 * 在 `window.fetch` 上装一层壳，就能在不改任何业务代码的前提下接管全部请求，
 * 也就意味着**主仓库和演示产物共用同一份源码**，不存在"演示版功能对不上"的漂移。
 *
 * 否决过的替代方案：
 * - Service Worker：`/api` 在站点根路径上，SW 的 scope 覆盖不到根路径之外的请求，
 *   而且首次访问要等 SW 注册完才生效（第一屏必然穿透）。
 * - 改 `request()` 加分支：要动到每个 API 文件的调用点，且 `consumeSSE` 那条链路
 *   走的是另一个函数，容易漏。
 * - MSW：需要把 mock 定义打进产物，比"读取 JSON + 匹配路径"重得多，且它自带
 *   Service Worker 模式，仍绕不开上面的 scope 问题。
 *
 * ## 语义
 *
 * - **只读 GET**：按路径（含 query）命中快照就回放；未命中回 404 空 JSON，
 *   让页面走自己的空态分支，而不是白屏。
 * - **写操作**（POST/PUT/PATCH/DELETE）：一律回 403 + 中文说明。演示站是纯静态的，
 *   没有任何后端，放行只会得到网络错误，用户看到的是"网络异常"这种误导性提示。
 *   **例外见 `READ_ONLY_EXEMPT`**：少数 POST 其实只做计算、不改数据，回放快照更诚实。
 * - **AI 流式**：`consumeSSE` 的请求也走 POST，但它期望的是 SSE 文本流。
 *   用预录事件按真实节奏回放，用户就能看到"打字机"效果——这是演示站里
 *   最容易被误认为"真接了模型"的地方，所以必须靠页面上的告警条说清是回放。
 */

const READ_ONLY_EXEMPT = new Set<string>([
  // 这几条虽然用 POST，但不落库：只做解析/生成/预览。演示站回放快照即可。
  "/api/jobs/parse-text",
  "/api/jobs/parse-multiple",
  "/api/profile/parse-text",
  "/api/claims/draft",
  "/api/apply/greeting/preview",
  "/api/ats/check",
  "/api/resume-templates/preview",
]);

/** 演示站里所有写操作的统一拒绝文案。 */
export const DEMO_WRITE_MESSAGE =
  "这是在线体验版，数据是虚构的快照，无法真正保存改动。下载完整版后所有操作都会真实生效。";

interface SnapshotRoute {
  status: number;
  body: unknown;
}

interface DemoSettings {
  /** 快照 JSON 的地址（相对产物根，Pages 部署下要能被 base 正确解析）。 */
  snapshotUrl: string;
  /** AI 回复的回放素材。 */
  aiRepliesUrl: string;
}

interface DemoSnapshot {
  routes: Record<string, SnapshotRoute>;
}

interface AiReply {
  /** 触发这条回放的用户输入关键词；空数组表示"兜底回复"。 */
  match?: string[];
  /** 逐字回放的内容。 */
  text: string;
}

interface AiReplies {
  replies: AiReply[];
  /** 每字间隔毫秒数的合理区间，回放时按此节奏吐字。 */
  charDelayMs?: number;
  /** 简历生成的流式回放文本（单独一条，不从 replies 里挑）。 */
  resumeDraft?: string;
}

let routes: Record<string, SnapshotRoute> = {};
let aiReplies: AiReplies = { replies: [] };

/**
 * 会话的内存叠加层（只活在当前标签页里，刷新即清）。
 *
 * 为什么要它：应用现在的助手页落地是**空态**，访客开口的第一句话会走「新建会话」——
 * 那是一条写操作，若按只读拒绝，用户永远见不到「AI 预录回放」这件事。所以把
 * 「新建会话」虚拟成功，把随后的一问一答记进叠加层，详情与列表接口再把它并回去：
 * 问完之后回答不会因为详情重拉而消失，回放才是一个完整的体验。
 */
interface DemoExchange {
  role: string;
  content: string;
  created_at: string;
}

interface DemoConversationBrief {
  id: number;
  title: string;
  surface: string;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  group_name: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

let virtualConversationSeq = 0;
const demoConversations = new Map<number, DemoConversationBrief>();
const demoExchanges = new Map<number, DemoExchange[]>();

function nowIso(): string {
  return new Date().toISOString();
}

/** 把叠加层的一条问答补齐成页面可渲染的完整 AssistantMessage
 *（列表渲染会读 context.quoted / attachments 等字段，缺了就崩）。 */
function asDemoMessage(id: number, conversationId: number, exchange: DemoExchange) {
  return {
    id,
    conversation_id: conversationId,
    role: exchange.role,
    content: exchange.content,
    quoted_message_id: null,
    attachments: [],
    context: {},
    status: "complete",
    error: "",
    model: "",
    created_at: exchange.created_at,
  };
}

/** 把 URL 归一成快照的键：只保留 pathname + search。 */
export function normalizeKey(input: string): string {
  try {
    const url = new URL(input, "http://demo.local");
    return url.pathname + url.search;
  } catch {
    return input;
  }
}

/**
 * 命中快照。
 *
 * 先精确匹配（含 query），再退一步只按 pathname 匹配——前端有些请求会带可选参数
 * （例如 `?force=true`），录制时不会覆盖每一种组合，但它们的数据形状一致。
 */
export function lookup(key: string): SnapshotRoute | undefined {
  if (routes[key]) return routes[key];
  const qIndex = key.indexOf("?");
  if (qIndex === -1) return undefined;
  const path = key.slice(0, qIndex);
  if (routes[path]) return routes[path];
  // 再退一步：同路径的**任意**一条快照。用于 `?page_size=20` 这类录制时没出现、
  // 但页面上会出现（例如用户改了每页条数）的分页参数。
  const prefix = path + "?";
  for (const candidate of Object.keys(routes)) {
    if (candidate.startsWith(prefix)) return routes[candidate];
  }
  return undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 演示站统一的"只读"拒绝响应，走 `ApiError` 的 detail 分支，用户能看到中文。 */
function readOnlyResponse(): Response {
  return jsonResponse({ detail: DEMO_WRITE_MESSAGE }, 403);
}

/** 按关键词挑一条回放回复；没有匹配到就走兜底。 */
export function pickReply(userText: string): string {
  const text = userText || "";
  for (const reply of aiReplies.replies) {
    if (!reply.match || reply.match.length === 0) continue;
    if (reply.match.some((kw) => text.includes(kw))) return reply.text;
  }
  const fallback = aiReplies.replies.find((r) => !r.match || r.match.length === 0);
  return fallback ? fallback.text : "（在线体验版没有接入真实大模型，这里是预录的回放内容。）";
}

/**
 * 把一段文本按真实节奏吐成 SSE 事件流。
 *
 * 事件形状必须和 `api/stream.ts` 期望的一致：`data: {json}\n\n`。
 * 用 ReadableStream 而不是直接返回整段，是为了让页面上的打字机效果跑起来——
 * 一次性返回会让"AI 在回复"这件事看起来像静态文本，反而不像真的。
 */
function streamReply(
  text: string,
  makeEvent: (chunk: string, done: boolean) => unknown,
  charDelayMs = 18,
  signal?: AbortSignal | null,
): Response {
  const encoder = new TextEncoder();
  const chunkSize = 2;
  let cursor = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        while (cursor < text.length) {
          if (signal?.aborted) break;
          const chunk = text.slice(cursor, cursor + chunkSize);
          cursor += chunkSize;
          push(makeEvent(chunk, false));
          await new Promise((resolve) => setTimeout(resolve, charDelayMs));
        }
        if (!signal?.aborted) push(makeEvent("", true));
      } catch {
        // 用户切页导致消费者提前关闭时，enqueue 会抛；这不影响演示，静默收尾即可。
      } finally {
        try {
          controller.close();
        } catch {
          /* 已经关闭 */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

/** 简历生成的流式回放（该 SSE 入口已无 UI 调用方——生成走后台任务；契约仍按 StreamEvent 对齐）。 */
function replayResumeStream(_body: unknown, signal?: AbortSignal | null): Response {
  const text =
    aiReplies.resumeDraft ||
    "（在线体验版没有接入真实大模型，这里是预录的回放内容。下载完整版即可用自己的资料真实生成。）";
  return streamReply(
    text,
    (chunk, done) =>
      done
        ? { type: "done", resume: { summary: text }, warnings: [] }
        : { type: "delta", text: chunk },
    12,
    signal,
  );
}

function isStreamPath(path: string): "assistant" | "resume" | null {
  if (/^\/api\/assistant\/conversations\/\d+\/messages$/.test(path)) return "assistant";
  if (/\/stream$/.test(path) && path.startsWith("/api/resumes")) return "resume";
  return null;
}

/**
 * 安装拦截层。调用一次即可，重复调用是幂等的。
 *
 * 参数只是为了让调用点与 `loadDemoData` 保持同一份配置形状（两个函数总是成对使用），
 * 拦截层本身只读模块级的 `routes` / `aiReplies`，不再解析地址。
 *
 * 返回一个 `uninstall`，测试里用它还原（避免污染同一进程里的其它用例）。
 */
export function installDemoFetch(): () => void {
  const original = window.fetch.bind(window);
  let installed: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null =
    null;

  const demoFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = normalizeKey(rawUrl);

    // 非 API 请求（静态资源、HMR、快照 JSON 自身）直接放行。
    if (!key.startsWith("/api/") && !key.startsWith("/api")) {
      return original(input, init);
    }

    const method = (
      init?.method ??
      (typeof input === "object" && "method" in input ? input.method : "GET") ??
      "GET"
    ).toUpperCase();
    const path = key.split("?")[0];

    if (method === "GET") {
      // 会话详情：快照命中时并上本轮新问的一问一答；虚拟会话直接用内存 brief 拼。
      const detailMatch = /^\/api\/assistant\/conversations\/(\d+)(\?|$)/.exec(key);
      if (detailMatch) {
        const id = Number(detailMatch[1]);
        const extra = demoExchanges.get(id) ?? [];
        const baseId = Math.max(0, ...(demoExchanges.get(id)?.map((_, i) => i) ?? []));
        const virtual = demoConversations.get(id);
        if (virtual) {
          return jsonResponse({
            ...virtual,
            messages: extra.map((exchange, index) => asDemoMessage(index + 1, id, exchange)),
          });
        }
        const hit = lookup(key);
        if (hit) {
          const body = hit.body as { messages?: unknown[] } | undefined;
          return jsonResponse(
            extra.length && body
              ? {
                  ...body,
                  messages: [
                    ...(body.messages ?? []),
                    ...extra.map((exchange, index) =>
                      asDemoMessage(baseId + index + 1, id, exchange),
                    ),
                  ],
                }
              : hit.body,
            hit.status,
          );
        }
        return jsonResponse({ detail: "在线体验版未包含这个接口的数据。" }, 404);
      }
      // 会话列表：把本轮虚拟出来的会话插到最前面（真实列表仍是快照回放）。
      if (path === "/api/assistant/conversations" && demoConversations.size > 0) {
        const hit = lookup(key);
        if (hit) {
          const body = hit.body as { items?: unknown[] } | unknown[];
          const briefs = [...demoConversations.values()];
          if (Array.isArray(body)) {
            return jsonResponse([...briefs, ...body], hit.status);
          }
          return jsonResponse(
            { ...body, items: [...briefs, ...((body.items as unknown[]) ?? [])] },
            hit.status,
          );
        }
      }
      const hit = lookup(key);
      if (hit) return jsonResponse(hit.body, hit.status);
      // 未命中的只读接口：回空态而不是报错。页面据此走自己的空分支文案。
      return jsonResponse({ detail: "在线体验版未包含这个接口的数据。" }, 404);
    }

    if (READ_ONLY_EXEMPT.has(path)) {
      const hit = lookup(key);
      if (hit) return jsonResponse(hit.body, hit.status);
      return jsonResponse({ detail: "在线体验版未包含这个接口的数据。" }, 404);
    }

    // 新建会话：虚拟成功。随后的消息发送会落进流式回放（isStreamPath 只看路径形状）。
    if (method === "POST" && path === "/api/assistant/conversations") {
      virtualConversationSeq += 1;
      const body = parseBody(init) as { title?: string; surface?: string };
      const stamp = nowIso();
      const brief: DemoConversationBrief = {
        id: 99000 + virtualConversationSeq,
        title: (body?.title || "").trim() || "新对话",
        surface: body?.surface ?? "page",
        pinned: false,
        favorite: false,
        archived: false,
        group_name: "",
        message_count: 0,
        created_at: stamp,
        updated_at: stamp,
      };
      demoConversations.set(brief.id, brief);
      return jsonResponse(brief, 201);
    }

    const streamKind = isStreamPath(path);
    if (streamKind === "assistant") {
      // 一问一答记进叠加层：详情重拉时刚问的内容不会消失。
      const id = Number(path.split("/")[4]);
      const payload = parseBody(init) as { content?: string };
      const reply = pickReply(typeof payload.content === "string" ? payload.content : "");
      const stamp = nowIso();
      const list = demoExchanges.get(id) ?? [];
      list.push(
        {
          role: "user",
          content: typeof payload.content === "string" ? payload.content : "",
          created_at: stamp,
        },
        { role: "assistant", content: reply, created_at: stamp },
      );
      demoExchanges.set(id, list);
      const brief = demoConversations.get(id);
      if (brief) {
        brief.message_count = list.length;
        brief.updated_at = stamp;
      }
      return streamReply(
        reply,
        (chunk, done) =>
          done
            ? {
                type: "done",
                message: asDemoMessage(0, id, {
                  role: "assistant",
                  content: reply,
                  created_at: stamp,
                }),
              }
            : { type: "delta", text: chunk },
        16,
        init?.signal,
      );
    }
    if (streamKind === "resume") return replayResumeStream(parseBody(init), init?.signal);

    return readOnlyResponse();
  };

  window.fetch = demoFetch as typeof window.fetch;
  installed = demoFetch;

  return () => {
    if (installed && window.fetch === (installed as unknown as typeof window.fetch)) {
      window.fetch = original;
    }
  };
}

function parseBody(init?: RequestInit): unknown {
  if (!init?.body) return {};
  if (typeof init.body !== "string") return {};
  try {
    return JSON.parse(init.body);
  } catch {
    return {};
  }
}

/**
 * 拉取快照素材。放在 `installDemoFetch` 之外是刻意的：
 * 调用方（`demoBootstrap`）先 await 数据到位再安装拦截，否则首屏的几个请求
 * 会在快照还没解析完时穿透出去，打到不存在的后端上。
 */
export async function loadDemoData(settings: DemoSettings): Promise<void> {
  const [snapshotResp, repliesResp] = await Promise.all([
    fetch(settings.snapshotUrl),
    fetch(settings.aiRepliesUrl).catch(() => null),
  ]);
  if (!snapshotResp.ok) {
    throw new Error(`演示数据加载失败（HTTP ${snapshotResp.status}）`);
  }
  const snapshot = (await snapshotResp.json()) as DemoSnapshot;
  routes = snapshot.routes ?? {};
  if (repliesResp && repliesResp.ok) {
    aiReplies = (await repliesResp.json()) as AiReplies;
  }
  // 换了快照就是换了一份演示数据：上一份的虚拟会话与问答叠加层一并作废。
  virtualConversationSeq = 0;
  demoConversations.clear();
  demoExchanges.clear();
}

/** 测试与诊断用：暴露当前已加载的路由表。 */
export function __getLoadedRoutes(): Record<string, SnapshotRoute> {
  return routes;
}

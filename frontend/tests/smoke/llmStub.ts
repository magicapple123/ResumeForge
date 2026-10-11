/**
 * 本机 OpenAI 兼容 stub server（RF-22）：简历生成的浏览器冒烟不能打真模型，
 * 而 LLM 调用发生在**后端进程内**，`page.route` 拦不到——所以起一个真 HTTP
 * 服务，让后端经"设置 → LLM 配置"指向它。
 *
 * 事件序列严格对齐 `backend/app/services/llm/openai_compat.py` 的流解析：
 * - 每帧一行 `data: {json}`，取 `choices[0].delta.content` 为增量正文；
 * - 收尾帧带 `finish_reason: "stop"`（帧级捕获，允许收尾帧无 delta）；
 * - 最后 `data: [DONE]` 结束。
 * 同时支持非流式请求（`body.stream` 非 true 时返回完整 JSON 响应），覆盖
 * 生成链路的"格式修复 chat"那一类调用形态。
 *
 * 行为模式按请求体里的 `model` 名切换（用例改配置里的模型名即可换模式，
 * 不需要重启 stub）：
 * - `stub-ok`   ：完整合法 JSON 简历一次性输出；
 * - `stub-slow` ：同样的内容切成小块慢速输出（生成中关弹窗/取消用例的窗口期）；
 * - `stub-broken`：先发几帧再**粗暴断开连接**，模拟真实断流——httpx 会抛
 *   RequestError，后端把任务标为 failed。
 *
 * 用 Playwright 的 `test.beforeAll/afterAll` 在测试进程内启停（workers=1 只起
 * 一次）；端口由系统分配（listen(0)），CI 与本机都不需要预留端口。
 */
import * as http from "node:http";
import type { AddressInfo } from "node:net";

/** stub 输出的简历 JSON：字段结构与后端 coerce_resume 的宽松解析对齐。 */
export const STUB_RESUME_JSON = JSON.stringify({
  name: "冒烟测试员",
  job_intent: "测试工程师",
  summary: "这是一份用于浏览器冒烟测试的简历。",
  experience: [
    {
      company: "冒烟科技有限公司",
      role: "测试工程师",
      start_date: "2024-01",
      end_date: "2025-01",
      description: ["负责浏览器冒烟测试链路的质量保障与自动化建设。"],
    },
  ],
  skills: [{ name: "自动化测试", level: "熟练" }],
});

const SLOW_CHUNK_INTERVAL_MS = 350;
const SLOW_CHUNK_CHARS = 12;

export interface LlmStub {
  /** 填进 LLM 配置 base_url 的服务根地址（http://127.0.0.1:<port>/v1）。 */
  url: string;
  close: () => Promise<void>;
}

function sseFrame(delta: object, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-smoke-stub",
    object: "chat.completion.chunk",
    created: 1,
    model: "smoke-stub",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/** 把文本按块流式写出；返回每块的 content 帧。 */
function contentFrames(text: string, chunkChars: number): string[] {
  const frames: string[] = [];
  for (let index = 0; index < text.length; index += chunkChars) {
    frames.push(sseFrame({ content: text.slice(index, index + chunkChars) }));
  }
  return frames;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startLlmStub(): Promise<LlmStub> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let mode: "ok" | "slow" | "broken" = "ok";
      let stream = false;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          model?: string;
          stream?: boolean;
        };
        stream = body.stream === true;
        const model = body.model ?? "";
        if (model.includes("slow")) mode = "slow";
        else if (model.includes("broken")) mode = "broken";
      } catch {
        // 解析不了请求体就按 ok 模式兜底：stub 只服务冒烟用例，不需要报错仪式感。
      }

      const sendSse = (frames: string[]) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write(frames.join(""));
        res.write(sseFrame({}, "stop"));
        res.write("data: [DONE]\n\n");
        res.end();
      };

      if (!stream) {
        // 非流式（生成链路的格式修复 chat 等）：完整 JSON 响应。
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-smoke-stub",
            object: "chat.completion",
            created: 1,
            model: "smoke-stub",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: STUB_RESUME_JSON },
                finish_reason: "stop",
              },
            ],
          }),
        );
        return;
      }

      if (mode === "broken") {
        // 先给一帧再断开：httpx 在流中途收到断连 → RequestError → 任务 failed。
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write(sseFrame({ content: STUB_RESUME_JSON.slice(0, 10) }));
        setTimeout(() => {
          res.socket?.destroy();
        }, 100);
        return;
      }

      const frames = contentFrames(STUB_RESUME_JSON, SLOW_CHUNK_CHARS);
      if (mode === "ok") {
        sendSse(frames);
        return;
      }
      // slow：逐帧慢速输出，给"关弹窗→后台继续"留出真实的时间窗口。
      void (async () => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        for (const frame of frames) {
          if (res.destroyed) return;
          res.write(frame);
          await sleep(SLOW_CHUNK_INTERVAL_MS);
        }
        if (res.destroyed) return;
        res.end(`${sseFrame({}, "stop")}data: [DONE]\n\n`);
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

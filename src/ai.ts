import type { AppBindings } from "./env";
import type { EvaluationInput, EvaluationResult } from "./domain";
import { logEvent, safeJson, shanghaiDate } from "./util";

const MAX_AI_INPUT_CHARS = 8_000;
const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8" as const;

async function reserveAiCall(env: AppBindings): Promise<boolean> {
  const limit = Math.max(0, Number.parseInt(env.AI_DAILY_CALL_LIMIT, 10) || 0);
  if (limit === 0) return false;
  const date = shanghaiDate();
  const row = await env.DB.prepare(`
    INSERT INTO ai_usage_daily (usage_date, call_count, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(usage_date) DO UPDATE SET
      call_count = ai_usage_daily.call_count + 1,
      updated_at = excluded.updated_at
    WHERE ai_usage_daily.call_count < ?
    RETURNING call_count
  `).bind(date, new Date().toISOString(), limit).first<{ call_count: number }>();
  return row !== null;
}

function textFromAiResult(result: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    for (const item of result) {
      const text = textFromAiResult(item, depth + 1);
      if (text) return text;
    }
    return null;
  }
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.response === "string") return record.response;
  if (typeof record.result === "string") return record.result;
  for (const key of ["response", "result", "output", "content", "text"]) {
    const nested = textFromAiResult(record[key], depth + 1);
    if (nested) return nested;
  }
  if (Array.isArray(record.choices)) {
    const first = record.choices[0];
    if (first && typeof first === "object") {
      const choice = first as Record<string, unknown>;
      if (typeof choice.text === "string") return choice.text;
      if (choice.message && typeof choice.message === "object") {
        const message = choice.message as Record<string, unknown>;
        const content = textFromAiResult(message.content, depth + 1);
        if (content) return content;
      }
    }
  }
  return null;
}

function aiResultShape(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return { type: typeof result };
  const record = result as Record<string, unknown>;
  const firstChoice = Array.isArray(record.choices) && record.choices[0] && typeof record.choices[0] === "object"
    ? record.choices[0] as Record<string, unknown>
    : null;
  const message = firstChoice?.message && typeof firstChoice.message === "object"
    ? firstChoice.message as Record<string, unknown>
    : null;
  const response = record.response;
  return {
    type: typeof result,
    keys: Object.keys(record).slice(0, 20),
    responseType: typeof response,
    responseKeys: response && typeof response === "object" ? Object.keys(response).slice(0, 20) : [],
    firstChoiceKeys: firstChoice ? Object.keys(firstChoice).slice(0, 20) : [],
    messageKeys: message ? Object.keys(message).slice(0, 20) : [],
    contentType: typeof message?.content,
  };
}

export async function explainEvaluation(
  env: AppBindings,
  input: EvaluationInput,
  result: EvaluationResult,
): Promise<{ en: string; zh: string; usedAi: boolean }> {
  try {
    if (!(await reserveAiCall(env))) return { ...result.deterministicRationale, usedAi: false };
    const payload = safeJson({
      opportunity: input,
      deterministicEvaluation: result,
      constraints: [
        "Do not change the numeric score or safety decision.",
        "Do not recommend betting, speculation, deposits, or automatic wallet signing.",
        "Return concise JSON with en and zh string fields only.",
      ],
    }).slice(0, MAX_AI_INPUT_CHARS);
    const aiResult = await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content: "Explain a deterministic Web3 work-opportunity evaluation. Preserve every safety gate and number. Output strict JSON only.",
        },
        { role: "user", content: `${payload}\n/no_think` },
      ],
      temperature: 0,
      max_tokens: 320,
      response_format: { type: "json_object" },
    });
    const text = textFromAiResult(aiResult);
    if (!text) {
      logEvent("ai.empty_evaluation_result", aiResultShape(aiResult));
      return { ...result.deterministicRationale, usedAi: false };
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.en !== "string" || typeof parsed.zh !== "string") {
      return { ...result.deterministicRationale, usedAi: false };
    }
    return { en: parsed.en.slice(0, 1_200), zh: parsed.zh.slice(0, 1_200), usedAi: true };
  } catch (error) {
    logEvent("ai.evaluation_fallback", {
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return { ...result.deterministicRationale, usedAi: false };
  }
}

export async function explainMatchEvent(
  env: AppBindings,
  event: unknown,
): Promise<{ en: string; zh: string; usedAi: boolean }> {
  const fallback = {
    en: "A match event was recorded. Review the event card and official feed for context.",
    zh: "已记录一条比赛事件，请结合事件卡片和官方数据源理解比赛进程。",
    usedAi: false,
  };
  try {
    if (!(await reserveAiCall(env))) return fallback;
    const aiResult = await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content: "Explain a sports event for fans in plain English and Chinese. Never provide odds, betting advice, profit forecasts, or trading calls. Output strict JSON with en and zh.",
        },
        { role: "user", content: `${safeJson(event).slice(0, 4_000)}\n/no_think` },
      ],
      temperature: 0,
      max_tokens: 220,
      response_format: { type: "json_object" },
    });
    const text = textFromAiResult(aiResult);
    if (!text) {
      logEvent("ai.empty_match_result", aiResultShape(aiResult));
      return fallback;
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.en !== "string" || typeof parsed.zh !== "string") return fallback;
    return { en: parsed.en.slice(0, 800), zh: parsed.zh.slice(0, 800), usedAi: true };
  } catch (error) {
    logEvent("ai.match_fallback", {
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return fallback;
  }
}

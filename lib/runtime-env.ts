import { env } from "cloudflare:workers";

export type RuntimeEnv = {
  DB: D1Database;
  DEEPSEEK_API_KEY?: string;
  TUSHARE_TOKEN?: string;
  TASK_SECRET?: string;
  AI_MONTHLY_BUDGET_CNY?: string;
  AI_DAILY_REQUEST_LIMIT?: string;
};

export function getRuntimeEnv() {
  return env as unknown as RuntimeEnv;
}

import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  onboardingComplete: integer("onboarding_complete", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_users_username").on(table.username)]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_sessions_token_hash").on(table.tokenHash)]);

export const riskProfiles = sqliteTable("risk_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  capitalBand: text("capital_band").notNull(),
  monthlyContribution: real("monthly_contribution").notNull(),
  experience: text("experience").notNull(),
  objective: text("objective").notNull(),
  stockHorizon: text("stock_horizon").notNull(),
  fundHorizon: text("fund_horizon").notNull(),
  routineRiskPct: real("routine_risk_pct").notNull(),
  absoluteRiskPct: real("absolute_risk_pct").notNull(),
  maxDrawdownPct: real("max_drawdown_pct").notNull(),
  preferredAssets: text("preferred_assets").notNull(),
  excludedScope: text("excluded_scope").notNull().default(""),
  currentHoldings: text("current_holdings").notNull().default("[]"),
  fundLedgerEnabled: integer("fund_ledger_enabled", { mode: "boolean" }).notNull().default(true),
  stockLedgerEnabled: integer("stock_ledger_enabled", { mode: "boolean" }).notNull().default(true),
  acceptedDisclaimer: integer("accepted_disclaimer", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_risk_profiles_user_version").on(table.userId, table.version)]);

export const loginAttempts = sqliteTable("login_attempts", {
  username: text("username").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
  lockedUntil: text("locked_until"),
});

export const watchlist = sqliteTable("watchlist", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  assetType: text("asset_type", { enum: ["stock", "fund", "etf"] }).notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_watchlist_user_symbol").on(table.userId, table.symbol)]);

export const ledgerEntries = sqliteTable("ledger_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ledgerType: text("ledger_type", { enum: ["fund_real", "stock_sim"] }).notNull(),
  symbol: text("symbol").notNull(),
  assetName: text("asset_name").notNull(),
  side: text("side", { enum: ["buy", "sell", "subscribe", "redeem", "dividend"] }).notNull(),
  tradeDate: text("trade_date").notNull(),
  price: real("price").notNull().default(0),
  quantity: real("quantity").notNull().default(0),
  amount: real("amount").notNull().default(0),
  fees: real("fees").notNull().default(0),
  thesis: text("thesis").notNull().default(""),
  invalidation: text("invalidation").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  reportType: text("report_type", { enum: ["daily_public", "daily_personal", "weekly"] }).notNull(),
  tradingDate: text("trading_date").notNull(),
  generatedAt: text("generated_at").notNull(),
  dataCutoff: text("data_cutoff").notNull(),
  profileVersion: integer("profile_version"),
  version: integer("version").notNull().default(1),
  status: text("status", { enum: ["draft", "published", "partial", "delayed"] }).notNull(),
  payloadJson: text("payload_json").notNull(),
  integrityHash: text("integrity_hash").notNull(),
  lockedAt: text("locked_at"),
});

export const reportSupplements = sqliteTable("report_supplements", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const taskRuns = sqliteTable("task_runs", {
  id: text("id").primaryKey(),
  taskKey: text("task_key").notNull(),
  taskType: text("task_type").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  detail: text("detail").notNull().default(""),
}, (table) => [uniqueIndex("idx_task_runs_task_key").on(table.taskKey)]);

export const aiUsage = sqliteTable("ai_usage", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  usageDate: text("usage_date").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCostCny: real("estimated_cost_cny").notNull().default(0),
}, (table) => [uniqueIndex("idx_ai_usage_user_date").on(table.userId, table.usageDate)]);

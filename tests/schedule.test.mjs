import assert from "node:assert/strict";
import test from "node:test";

function shouldGenerateDailyReport(now, isTradingDay) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return isTradingDay(tomorrow);
}

function taskKey(taskType, tradingDate, userId = "public") {
  return `${taskType}:${tradingDate}:${userId}`;
}

function isShanghaiWeekend(date) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+08:00`));
  return weekday === "Sat" || weekday === "Sun";
}

test("Sunday night generates Monday report when Monday is a trading day", () => {
  const sunday = new Date("2026-08-09T12:00:00.000Z");
  assert.equal(shouldGenerateDailyReport(sunday, (date) => date.getUTCDay() === 1), true);
});

test("does not generate when tomorrow is not a trading day", () => {
  const friday = new Date("2026-08-07T12:00:00.000Z");
  assert.equal(shouldGenerateDailyReport(friday, (date) => ![0, 6].includes(date.getUTCDay())), false);
});

test("task keys are idempotent per trading date and owner", () => {
  assert.equal(taskKey("daily", "2026-08-10"), taskKey("daily", "2026-08-10"));
  assert.notEqual(taskKey("daily", "2026-08-10", "u1"), taskKey("daily", "2026-08-10", "u2"));
});

test("Shanghai calendar fallback does not classify Monday as Sunday", () => {
  assert.equal(isShanghaiWeekend("2026-08-10"), false);
  assert.equal(isShanghaiWeekend("2026-08-09"), true);
});

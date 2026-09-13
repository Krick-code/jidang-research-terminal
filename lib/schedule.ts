export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

export function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function isShanghaiWeekend(date: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI_TIME_ZONE,
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+08:00`));
  return weekday === "Sat" || weekday === "Sun";
}

export function shouldGenerateDailyReport(now: Date, isTradingDay: (date: Date) => boolean) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return isTradingDay(tomorrow);
}

export function taskKey(taskType: string, tradingDate: string, userId = "public") {
  return `${taskType}:${tradingDate}:${userId}`;
}

export function reportStatusForMissedRun(scheduledAt: Date, actualAt: Date) {
  return actualAt.getTime() - scheduledAt.getTime() > 15 * 60 * 1000 ? "delayed" : "published";
}

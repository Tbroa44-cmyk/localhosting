import getDb from "@/lib/db";

export interface TradingStatus {
  isOpen: boolean;
  message: string;
  openHour: number;
  closeHour: number;
  tradingDays: number[];
  emergencyClose: boolean;
  emergencyMessage: string;
  nextChange: string;
  nextChangeMs: number;
}

function parseTradingDays(tradingDays: string | null): number[] {
  if (!tradingDays) return [1, 2, 3, 4, 5, 6, 7];
  return tradingDays.split(",").map(Number).filter(n => n >= 0 && n <= 6);
}

function getAESTDate(): { year: number; month: number; day: number; dayOfWeek: number; hour: number; minute: number } {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const aestMs = utcMs + 10 * 3600000;
  const aest = new Date(aestMs);
  return {
    year: aest.getFullYear(),
    month: aest.getMonth(),
    day: aest.getDate(),
    dayOfWeek: aest.getDay(),
    hour: aest.getHours(),
    minute: aest.getMinutes(),
  };
}

function aestDateStr(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function addDays(d: { year: number; month: number; day: number }, n: number) {
  const dt = new Date(d.year, d.month, d.day + n);
  return { year: dt.getFullYear(), month: dt.getMonth(), day: dt.getDate() };
}

function getMsUntilTarget(target: { year: number; month: number; day: number; hour: number; minute: number }): number {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const aestMs = utcMs + 10 * 3600000;
  const aestNow = new Date(aestMs);
  const targetDt = new Date(target.year, target.month, target.day, target.hour, target.minute);
  return targetDt.getTime() - aestNow.getTime();
}

function formatMs(ms: number): string {
  if (ms <= 0) return "now";
  const totalMins = Math.ceil(ms / 60000);
  const days = Math.floor(totalMins / (24 * 60));
  const hours = Math.floor((totalMins % (24 * 60)) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function safeMsUntilTarget(target: { year: number; month: number; day: number; hour: number; minute: number }): number {
  let ms = getMsUntilTarget(target);
  if (ms <= 0) {
    const next = addDays(target, 1);
    ms = getMsUntilTarget({ ...next, hour: target.hour, minute: target.minute });
  }
  if (ms <= 0) {
    const next2 = addDays(target, 2);
    ms = getMsUntilTarget({ ...next2, hour: target.hour, minute: target.minute });
  }
  return Math.max(ms, 60000);
}

export async function getTradingInfo(db?: any): Promise<TradingStatus> {
  try {
    const database = db || getDb();
    const settings = await database.prepare("SELECT * FROM settings WHERE id = 1").get() as any;

    if (!settings) {
      return {
        isOpen: true, message: "Markets open 24/7", openHour: 0, closeHour: 24, tradingDays: [0, 1, 2, 3, 4, 5, 6],
        emergencyClose: false, emergencyMessage: "", nextChange: "", nextChangeMs: 0,
      };
    }

    const openHour = Number(settings.trading_open_hour) || 0;
    const closeHour = Number(settings.trading_close_hour) || 24;
    const tradingEnabled = Number(settings.trading_enabled);
    const emergencyClose = Number(settings.emergency_close) === 1;
    const emergencyMessage = settings.emergency_message || "Markets under maintenance";
    const tradingDays = parseTradingDays(settings.trading_days);
    const now = getAESTDate();

    let customRanges: any[] = [];
    try {
      customRanges = await database.prepare("SELECT * FROM custom_date_ranges WHERE enabled = 1").all() as any[];
    } catch {}

    const todayStr = aestDateStr(now);

    // 1. Emergency close (highest priority)
    if (emergencyClose) {
      return {
        isOpen: false, message: emergencyMessage, openHour, closeHour, tradingDays,
        emergencyClose: true, emergencyMessage, nextChange: "until markets reopen", nextChangeMs: 0,
      };
    }

    // 2. Check if in an active custom date range (market closed during these dates)
    for (const range of customRanges) {
      if (todayStr >= range.start_date && todayStr <= range.end_date) {
        const endParts = range.end_date.split("-").map(Number);
        const target = { year: endParts[0], month: endParts[1] - 1, day: endParts[2], hour: openHour, minute: 0 };
        const msUntil = safeMsUntilTarget(target);
        return {
          isOpen: false, message: range.label || `Markets closed: ${range.start_date} to ${range.end_date}`,
          openHour, closeHour, tradingDays, emergencyClose: false, emergencyMessage,
          nextChange: `opens in ${formatMs(msUntil)}`, nextChangeMs: msUntil,
        };
      }
    }

    // 3. Check if today is a trading day
    if (!tradingDays.includes(now.dayOfWeek)) {
      let daysAhead = 0;
      for (let i = 1; i <= 7; i++) {
        const nextDate = addDays(now, i);
        const nextDow = new Date(nextDate.year, nextDate.month, nextDate.day).getDay();
        if (tradingDays.includes(nextDow)) {
          daysAhead = i;
          break;
        }
      }
      if (daysAhead === 0) daysAhead = 1;
      const target = addDays(now, daysAhead);
      const targetMs = safeMsUntilTarget({ ...target, hour: openHour, minute: 0 });
      return {
        isOpen: false, message: "Markets closed today", openHour, closeHour, tradingDays,
        emergencyClose: false, emergencyMessage,
        nextChange: `opens in ${formatMs(targetMs)}`, nextChangeMs: targetMs,
      };
    }

    // 4. Default 24/7 check
    if (tradingEnabled === 1 && openHour === 0 && closeHour === 24 && tradingDays.length === 7) {
      return {
        isOpen: true, message: "Markets open 24/7", openHour, closeHour, tradingDays,
        emergencyClose: false, emergencyMessage, nextChange: "", nextChangeMs: 0,
      };
    }

    // 5. Check trading_enabled
    if (tradingEnabled === 0) {
      return {
        isOpen: false, message: "Markets closed by admin", openHour, closeHour, tradingDays,
        emergencyClose: false, emergencyMessage, nextChange: "until admin reopens", nextChangeMs: 0,
      };
    }

    // 6. Check trading hours
    const isOpen = now.hour >= openHour && now.hour < closeHour;

    if (isOpen) {
      const targetMs = safeMsUntilTarget({ ...now, hour: closeHour, minute: 0 });
      return {
        isOpen: true, message: `Markets open ${openHour}:00 - ${closeHour}:00`,
        openHour, closeHour, tradingDays, emergencyClose: false, emergencyMessage,
        nextChange: `closes in ${formatMs(targetMs)}`, nextChangeMs: targetMs,
      };
    } else {
      const targetMs = safeMsUntilTarget({ ...now, hour: openHour, minute: 0 });
      return {
        isOpen: false, message: `Markets closed. Opens at ${openHour}:00`,
        openHour, closeHour, tradingDays, emergencyClose: false, emergencyMessage,
        nextChange: `opens in ${formatMs(targetMs)}`, nextChangeMs: targetMs,
      };
    }
  } catch {
    return {
      isOpen: true, message: "Markets open", openHour: 0, closeHour: 24, tradingDays: [0, 1, 2, 3, 4, 5, 6],
      emergencyClose: false, emergencyMessage: "", nextChange: "", nextChangeMs: 0,
    };
  }
}

export async function isTradingOpen(db?: any): Promise<boolean> {
  const info = await getTradingInfo(db);
  return info.isOpen;
}

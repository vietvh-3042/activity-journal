export function localDayRange(date: string): { fromUtc: string; toUtc: string } {
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
}

export function localWeekRange(reference = new Date()): { fromUtc: string; toUtc: string } {
  const from = new Date(reference);
  from.setHours(0, 0, 0, 0);
  const day = (from.getDay() + 6) % 7;
  from.setDate(from.getDate() - day);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
}

export function todayInputValue(date = new Date()): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  if (minutes > 0) return `${minutes} phút`;
  return `${rounded} giây`;
}

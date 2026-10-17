/** Display-only formatting. API values (ISO timestamps, KRW integers) are never rewritten. */
const dateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** `2026. 10. 17. 10:02:03` in Korean time; an unparsable value is labelled instead of thrown. */
export function formatKstDateTime(value: string | number | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? dateTime.format(parsed) : "일시 확인 불가";
}

export const formatKrw = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

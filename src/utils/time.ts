const pad = (n: number) => String(n).padStart(2, '0');

/** "HH:mm" -> minutes from midnight */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Minutes from midnight -> "HH:mm" */
export function minutesToTime(totalMinutes: number): string {
  return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
}

/** Date -> "YYYY-MM-DD" in local time */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "YYYY-MM-DD" -> local Date at midnight (optionally offset by some minutes) */
export function parseDateString(dateString: string, minutes = 0): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day, 0, minutes);
}

export function addDays(dateString: string, days: number): string {
  const date = parseDateString(dateString);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

/** Date -> local ISO 8601 datetime without offset ("YYYY-MM-DDTHH:mm:ss") */
export function toLocalISO(date: Date): string {
  return `${toDateString(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "YYYY-MM-DD" + minutes from midnight -> local ISO datetime */
export function combineDateAndMinutes(dateString: string, minutes: number): string {
  return toLocalISO(parseDateString(dateString, minutes));
}

/** Minutes between local midnight of `dateString` and an ISO datetime (may be negative or > 1440) */
export function minutesFromDayStart(isoDateTime: string, dateString: string): number {
  return Math.round((new Date(isoDateTime).getTime() - parseDateString(dateString).getTime()) / 60000);
}

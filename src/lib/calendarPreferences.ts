import type { AppSettings, CalendarTimeFormat } from '../types';

export interface CalendarWindow {
  startHour: number;
  endHour: number;
  slotCount: number;
}

function clampHour(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function getCalendarWindow(settings: Pick<AppSettings, 'calendarDayRange' | 'calendarDayStartHour' | 'calendarDayEndHour'>): CalendarWindow {
  if (settings.calendarDayRange === 'full-day') return { startHour: 0, endHour: 24, slotCount: 48 };
  if (settings.calendarDayRange === 'standard') return { startHour: 8, endHour: 19, slotCount: 22 };

  const startHour = clampHour(settings.calendarDayStartHour, 0, 23);
  const requestedEnd = clampHour(settings.calendarDayEndHour, 1, 24);
  const endHour = Math.max(startHour + 1, requestedEnd);
  return { startHour, endHour, slotCount: (endHour - startHour) * 2 };
}

export function formatCalendarClock(hour: number, minute: number, format: CalendarTimeFormat) {
  if (format === '24h') return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return minute ? `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}` : `${displayHour} ${suffix}`;
}

export function formatScheduledTime(iso: string, format: CalendarTimeFormat, includeMinutes = true) {
  const date = new Date(iso);
  return formatCalendarClock(date.getHours(), includeMinutes ? date.getMinutes() : 0, format);
}

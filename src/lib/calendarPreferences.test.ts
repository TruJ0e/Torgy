import { describe, expect, it } from 'vitest';
import { formatCalendarClock, getCalendarSlotHeight, getCalendarWindow } from './calendarPreferences';

describe('calendar preferences', () => {
  it('provides a compact standard day without losing 30-minute slots', () => {
    expect(getCalendarWindow({ calendarDayRange: 'standard', calendarDayStartHour: 4, calendarDayEndHour: 23 }))
      .toEqual({ startHour: 8, endHour: 19, slotCount: 22 });
  });

  it('supports a full 24-hour day', () => {
    expect(getCalendarWindow({ calendarDayRange: 'full-day', calendarDayStartHour: 7, calendarDayEndHour: 22 }))
      .toEqual({ startHour: 0, endHour: 24, slotCount: 48 });
  });

  it('clamps custom ranges and keeps at least one hour visible', () => {
    expect(getCalendarWindow({ calendarDayRange: 'custom', calendarDayStartHour: 23, calendarDayEndHour: 7 }))
      .toEqual({ startHour: 23, endHour: 24, slotCount: 2 });
  });

  it('expands shorter calendar ranges to fill the available grid height but keeps a readable minimum', () => {
    expect(getCalendarSlotHeight(22, 704)).toBe(32);
    expect(getCalendarSlotHeight(22, 770)).toBe(35);
    expect(getCalendarSlotHeight(48, 704)).toBe(32);
    expect(getCalendarSlotHeight(2, 704)).toBe(352);
  });

  it('formats either 12-hour or 24-hour clocks', () => {
    expect(formatCalendarClock(0, 0, '12h')).toBe('12 AM');
    expect(formatCalendarClock(13, 30, '12h')).toBe('1:30 PM');
    expect(formatCalendarClock(0, 0, '24h')).toBe('00:00');
    expect(formatCalendarClock(13, 30, '24h')).toBe('13:30');
  });
});

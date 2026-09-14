import { describe, expect, it } from 'vitest';
import { appearanceDataAttributes, DEFAULT_APPEARANCE_SETTINGS, normalizeAppearanceSettings } from './appearance';

describe('appearance preferences', () => {
  it('uses current visual defaults for older settings', () => {
    expect(normalizeAppearanceSettings({})).toEqual(DEFAULT_APPEARANCE_SETTINGS);
  });

  it('preserves valid preferences and replaces invalid values safely', () => {
    const normalized = normalizeAppearanceSettings({
      appearanceFont: 'verdana', appearanceTextSize: 'extra-large', appearanceTheme: 'not-a-theme' as never,
      appearanceDensity: 'compact', appearanceReadingSpacing: true, appearanceReducedMotion: true,
    });
    expect(normalized).toEqual({
      appearanceFont: 'verdana', appearanceTextSize: 'extra-large', appearanceTheme: 'neutral',
      appearanceDensity: 'compact', appearanceReadingSpacing: true, appearanceReducedMotion: true,
    });
    expect(appearanceDataAttributes(normalized)).toMatchObject({
      'data-appearance-font': 'verdana', 'data-appearance-theme': 'neutral', 'data-appearance-reduced-motion': 'true',
    });
  });
});

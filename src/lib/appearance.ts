import type { AppSettings } from '../types';

export type AppearanceSettings = Pick<AppSettings,
  | 'appearanceFont'
  | 'appearanceTextSize'
  | 'appearanceTheme'
  | 'appearanceDensity'
  | 'appearanceReadingSpacing'
  | 'appearanceReducedMotion'
>;

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  appearanceFont: 'system',
  appearanceTextSize: 'standard',
  appearanceTheme: 'neutral',
  appearanceDensity: 'comfortable',
  appearanceReadingSpacing: false,
  appearanceReducedMotion: false,
};

const fonts = new Set<AppearanceSettings['appearanceFont']>(['system', 'arial', 'verdana', 'georgia', 'dyslexia-friendly']);
const textSizes = new Set<AppearanceSettings['appearanceTextSize']>(['small', 'standard', 'large', 'extra-large']);
const themes = new Set<AppearanceSettings['appearanceTheme']>(['neutral', 'calm-blue', 'sage-green', 'soft-purple', 'high-contrast']);
const densities = new Set<AppearanceSettings['appearanceDensity']>(['compact', 'comfortable']);

export function normalizeAppearanceSettings(value: Partial<AppSettings> | null | undefined): AppearanceSettings {
  return {
    appearanceFont: fonts.has(value?.appearanceFont as AppearanceSettings['appearanceFont']) ? value!.appearanceFont! : DEFAULT_APPEARANCE_SETTINGS.appearanceFont,
    appearanceTextSize: textSizes.has(value?.appearanceTextSize as AppearanceSettings['appearanceTextSize']) ? value!.appearanceTextSize! : DEFAULT_APPEARANCE_SETTINGS.appearanceTextSize,
    appearanceTheme: themes.has(value?.appearanceTheme as AppearanceSettings['appearanceTheme']) ? value!.appearanceTheme! : DEFAULT_APPEARANCE_SETTINGS.appearanceTheme,
    appearanceDensity: densities.has(value?.appearanceDensity as AppearanceSettings['appearanceDensity']) ? value!.appearanceDensity! : DEFAULT_APPEARANCE_SETTINGS.appearanceDensity,
    appearanceReadingSpacing: typeof value?.appearanceReadingSpacing === 'boolean' ? value.appearanceReadingSpacing : DEFAULT_APPEARANCE_SETTINGS.appearanceReadingSpacing,
    appearanceReducedMotion: typeof value?.appearanceReducedMotion === 'boolean' ? value.appearanceReducedMotion : DEFAULT_APPEARANCE_SETTINGS.appearanceReducedMotion,
  };
}

export function appearanceDataAttributes(settings: AppearanceSettings) {
  return {
    'data-appearance-font': settings.appearanceFont,
    'data-appearance-text-size': settings.appearanceTextSize,
    'data-appearance-theme': settings.appearanceTheme,
    'data-appearance-density': settings.appearanceDensity,
    'data-appearance-reading-spacing': settings.appearanceReadingSpacing ? 'true' : 'false',
    'data-appearance-reduced-motion': settings.appearanceReducedMotion ? 'true' : 'false',
  } as const;
}

/**
 * Color tokens.
 *
 * The palette follows the Vodacom-inspired visual language of the MegaBot
 * wireframe: a single strong brand red used for primary actions and accents,
 * on top of calm, cool neutrals. Status colors are reserved for state and are
 * always paired with an icon + label (never color alone).
 */

export type Tone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai';

export type ToneColors = {
  /** Filled backgrounds, dots, progress fills. */
  solid: string;
  /** Text and icons on neutral surfaces. */
  fg: string;
  /** Soft tinted backgrounds (badges, banners, icon wells). */
  bg: string;
};

export type ColorTokens = {
  brand: string;
  brandPressed: string;
  onBrand: string;

  background: string;
  surface: string;
  surfaceMuted: string;
  surfacePressed: string;
  surfaceInverse: string;
  border: string;
  borderStrong: string;
  overlay: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  tones: Record<Tone, ToneColors>;

  chart: {
    bar: string;
    barHighlight: string;
    grid: string;
  };

  chat: {
    wallpaper: string;
    incoming: string;
    outgoing: string;
    meta: string;
  };

  skeleton: string;
  tabBar: string;
};

const light: ColorTokens = {
  brand: '#E60000',
  brandPressed: '#C20000',
  onBrand: '#FFFFFF',

  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F1F4',
  surfacePressed: '#E8EAEE',
  surfaceInverse: '#15171C',
  border: '#E4E6EB',
  borderStrong: '#D0D4DB',
  overlay: 'rgba(10, 12, 16, 0.48)',

  text: '#111318',
  textSecondary: '#5A6170',
  textMuted: '#8A909C',
  textInverse: '#FFFFFF',

  tones: {
    brand: { solid: '#E60000', fg: '#C20000', bg: '#FDECEC' },
    neutral: { solid: '#6B7280', fg: '#4B5261', bg: '#EFF0F3' },
    success: { solid: '#12A150', fg: '#0B7A3B', bg: '#E7F6EC' },
    warning: { solid: '#F5A524', fg: '#9A5B00', bg: '#FEF4E2' },
    danger: { solid: '#D92D20', fg: '#B42318', bg: '#FDECEA' },
    info: { solid: '#2E6BE6', fg: '#1F55C4', bg: '#EAF1FE' },
    ai: { solid: '#7C5CFA', fg: '#5B3FD6', bg: '#F1EDFF' },
  },

  chart: {
    bar: '#CDD1D8',
    barHighlight: '#E60000',
    grid: '#ECEEF1',
  },

  chat: {
    wallpaper: '#EFE9E1',
    incoming: '#FFFFFF',
    outgoing: '#DCF8C6',
    meta: '#7A8088',
  },

  skeleton: '#E7E9ED',
  tabBar: '#FFFFFF',
};

const dark: ColorTokens = {
  brand: '#F0322B',
  brandPressed: '#D11F19',
  onBrand: '#FFFFFF',

  background: '#0E0F12',
  surface: '#17191D',
  surfaceMuted: '#1F2227',
  surfacePressed: '#262A30',
  surfaceInverse: '#F3F4F6',
  border: '#2A2E35',
  borderStrong: '#3A3F48',
  overlay: 'rgba(0, 0, 0, 0.6)',

  text: '#F3F4F6',
  textSecondary: '#A8AEBA',
  textMuted: '#737A87',
  textInverse: '#111318',

  tones: {
    brand: { solid: '#F0322B', fg: '#FF6B63', bg: '#3A1515' },
    neutral: { solid: '#8A909C', fg: '#B4BAC5', bg: '#22252B' },
    success: { solid: '#22C55E', fg: '#4ADE80', bg: '#0F2A1A' },
    warning: { solid: '#F5A524', fg: '#FBBF24', bg: '#2E2210' },
    danger: { solid: '#F04438', fg: '#F97066', bg: '#33151A' },
    info: { solid: '#4C8DFF', fg: '#7AA7FF', bg: '#13233F' },
    ai: { solid: '#9B82FF', fg: '#B6A4FF', bg: '#221C3D' },
  },

  chart: {
    bar: '#3A3F48',
    barHighlight: '#F0322B',
    grid: '#23262C',
  },

  chat: {
    wallpaper: '#0B141A',
    incoming: '#202C33',
    outgoing: '#005C4B',
    meta: '#8696A0',
  },

  skeleton: '#23262C',
  tabBar: '#17191D',
};

export const palettes = { light, dark } as const;

export type ColorSchemeName = keyof typeof palettes;

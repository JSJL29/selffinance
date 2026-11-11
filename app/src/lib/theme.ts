import { useColorScheme } from 'react-native';

const light = {
  bg: '#F4F5F7',
  card: '#FFFFFF',
  text: '#111418',
  muted: '#6B7280',
  border: '#E5E7EB',
  primary: '#2563EB',
  primaryText: '#FFFFFF',
  success: '#15803D',
  danger: '#B91C1C',
  tag: '#EEF0F3',
};

const dark: typeof light = {
  bg: '#0B0D10',
  card: '#15181D',
  text: '#F3F4F6',
  muted: '#9CA3AF',
  border: '#262A31',
  primary: '#60A5FA',
  primaryText: '#0B0D10',
  success: '#4ADE80',
  danger: '#F87171',
  tag: '#22262D',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

type BankMeta = { short: string; color: string };

const BANKS: Record<string, BankMeta> = {
  'Société Générale': { short: 'SG', color: '#E30613' },
  Revolut: { short: 'R', color: '#5B5F66' },
  'BNP Paribas': { short: 'BNP', color: '#00915A' },
  Fortuneo: { short: 'F', color: '#00A19A' },
  'Trade Republic': { short: 'TR', color: '#3F3F46' },
};

export function bankMeta(bank: string): BankMeta {
  return BANKS[bank] ?? { short: bank.slice(0, 2).toUpperCase(), color: '#6B7280' };
}

/** Nom court pour les filtres et sous-titres : « SG », « BNP », « Revolut »… */
export function bankShortName(bank: string): string {
  const m = bankMeta(bank);
  return m.short.length > 1 ? m.short : bank;
}

import type { Href } from 'expo-router';

import type { IconName, Tone } from '@/theme';

export type SettingsSectionId =
  | 'profile'
  | 'company'
  | 'payments'
  | 'notifications'
  | 'security'
  | 'subscription'
  | 'help'
  | 'appearance'
  | 'simulation';

export type SettingsEntry = {
  key: string;
  title: string;
  subtitle: string;
  icon: IconName;
  tone: Tone;
  href: Href;
};

const section = (id: SettingsSectionId): Href => ({ pathname: '/settings/[section]', params: { section: id } });

export const settingsGroups: { title: string; entries: SettingsEntry[] }[] = [
  {
    title: 'Conta',
    entries: [
      { key: 'profile', title: 'Perfil', subtitle: 'Nome, email e telefone', icon: 'user', tone: 'info', href: section('profile') },
      { key: 'company', title: 'Empresa', subtitle: 'Loja, nome no WhatsApp e mensagens', icon: 'business', tone: 'brand', href: section('company') },
      { key: 'security', title: 'Segurança', subtitle: 'PIN, biometria e sessões', icon: 'lock', tone: 'neutral', href: section('security') },
      { key: 'subscription', title: 'Assinatura', subtitle: 'Plano Pro · uso do mês', icon: 'subscription', tone: 'warning', href: section('subscription') },
    ],
  },
  {
    title: 'Operação',
    entries: [
      { key: 'payments', title: 'Pagamentos', subtitle: 'Contas e regras de reconciliação', icon: 'wallet', tone: 'success', href: section('payments') },
      { key: 'products', title: 'Produtos', subtitle: 'Pacotes e tabela de preços', icon: 'product', tone: 'brand', href: '/products' },
      { key: 'whatsapp', title: 'WhatsApp', subtitle: 'Sessão, grupos e conversas', icon: 'whatsapp', tone: 'success', href: '/whatsapp' },
      { key: 'devices', title: 'Dispositivos', subtitle: 'Android, SIMs e capacidade', icon: 'devices', tone: 'info', href: '/devices' },
      { key: 'automation', title: 'Automação', subtitle: 'Regras, failover e tarefas', icon: 'bolt', tone: 'ai', href: '/automation' },
      { key: 'notifications', title: 'Notificações', subtitle: 'O que merece um alerta', icon: 'bell', tone: 'warning', href: section('notifications') },
    ],
  },
  {
    title: 'Aplicação',
    entries: [
      { key: 'appearance', title: 'Aparência', subtitle: 'Tema claro, escuro ou do sistema', icon: 'contrast', tone: 'neutral', href: section('appearance') },
      { key: 'simulation', title: 'Modo de simulação', subtitle: 'Testar estados: offline, erros, vazio', icon: 'science', tone: 'ai', href: section('simulation') },
      { key: 'help', title: 'Ajuda', subtitle: 'Perguntas frequentes e suporte', icon: 'help', tone: 'info', href: section('help') },
    ],
  },
];

export const sectionTitles: Record<SettingsSectionId, string> = {
  profile: 'Perfil',
  company: 'Empresa',
  payments: 'Pagamentos',
  notifications: 'Notificações',
  security: 'Segurança',
  subscription: 'Assinatura',
  help: 'Ajuda',
  appearance: 'Aparência',
  simulation: 'Modo de simulação',
};

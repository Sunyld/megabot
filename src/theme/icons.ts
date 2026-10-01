import type { AndroidSymbol } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';

/**
 * Semantic icon registry. Screens reference icons by meaning (`icons.orders`),
 * never by platform glyph name, so the icon set can evolve in one place.
 *
 * Android/web use Google Material Symbols, iOS uses SF Symbols.
 * After adding an entry run `npm run generate:icons` to refresh the glyph map.
 */
type IconDef = { ios: SFSymbol; android: AndroidSymbol };

const defineIcons = <T extends Record<string, IconDef>>(map: T) => map;

export const icons = defineIcons({
  // navigation
  home: { ios: 'house', android: 'home' },
  orders: { ios: 'bag', android: 'shopping_bag' },
  payments: { ios: 'creditcard', android: 'payments' },
  devices: { ios: 'iphone', android: 'smartphone' },
  more: { ios: 'square.grid.2x2', android: 'grid_view' },
  back: { ios: 'chevron.left', android: 'arrow_back' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right' },
  chevronDown: { ios: 'chevron.down', android: 'expand_more' },
  close: { ios: 'xmark', android: 'close' },
  menu: { ios: 'ellipsis', android: 'more_vert' },

  // actions
  search: { ios: 'magnifyingglass', android: 'search' },
  filter: { ios: 'line.3.horizontal.decrease', android: 'filter_list' },
  add: { ios: 'plus', android: 'add' },
  edit: { ios: 'pencil', android: 'edit' },
  delete: { ios: 'trash', android: 'delete' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh' },
  send: { ios: 'paperplane', android: 'send' },
  play: { ios: 'play.fill', android: 'play_arrow' },
  pause: { ios: 'pause', android: 'pause' },
  power: { ios: 'power', android: 'power_settings_new' },
  copy: { ios: 'doc.on.doc', android: 'content_copy' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  link: { ios: 'link', android: 'link' },
  tune: { ios: 'slider.horizontal.3', android: 'tune' },
  eye: { ios: 'eye', android: 'visibility' },
  eyeOff: { ios: 'eye.slash', android: 'visibility_off' },

  // status
  check: { ios: 'checkmark', android: 'check' },
  checkCircle: { ios: 'checkmark.circle', android: 'check_circle' },
  taskDone: { ios: 'checkmark.seal', android: 'task_alt' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning' },
  error: { ios: 'xmark.octagon', android: 'error' },
  cancel: { ios: 'xmark.circle', android: 'cancel' },
  info: { ios: 'info.circle', android: 'info' },
  help: { ios: 'questionmark.circle', android: 'help' },
  unknown: { ios: 'questionmark', android: 'question_mark' },
  pending: { ios: 'hourglass', android: 'hourglass_top' },
  clock: { ios: 'clock', android: 'schedule' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  dot: { ios: 'circle.fill', android: 'fiber_manual_record' },
  priority: { ios: 'exclamationmark', android: 'priority_high' },

  // domain
  bell: { ios: 'bell', android: 'notifications' },
  bolt: { ios: 'bolt', android: 'bolt' },
  bot: { ios: 'cpu', android: 'smart_toy' },
  ai: { ios: 'sparkles', android: 'auto_awesome' },
  chat: { ios: 'message', android: 'chat' },
  whatsapp: { ios: 'bubble.left.and.bubble.right', android: 'forum' },
  groups: { ios: 'person.3', android: 'groups' },
  sms: { ios: 'message', android: 'sms' },
  ussd: { ios: 'circle.grid.3x3', android: 'dialpad' },
  sim: { ios: 'simcard', android: 'sim_card' },
  product: { ios: 'shippingbox', android: 'package_2' },
  data: { ios: 'antenna.radiowaves.left.and.right', android: 'data_usage' },
  sales: { ios: 'tag', android: 'sell' },
  revenue: { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up' },
  trendDown: { ios: 'chart.line.downtrend.xyaxis', android: 'trending_down' },
  chart: { ios: 'chart.bar', android: 'bar_chart' },
  receipt: { ios: 'doc.text', android: 'receipt_long' },
  wallet: { ios: 'wallet.pass', android: 'account_balance_wallet' },
  failover: { ios: 'arrow.triangle.branch', android: 'alt_route' },
  dispatcher: { ios: 'point.3.connected.trianglepath.dotted', android: 'hub' },
  sync: { ios: 'arrow.triangle.2.circlepath', android: 'sync' },
  speed: { ios: 'gauge', android: 'speed' },
  queue: { ios: 'ellipsis.circle', android: 'pending' },
  calendar: { ios: 'calendar', android: 'calendar_today' },
  table: { ios: 'tablecells', android: 'table_rows' },
  qr: { ios: 'qrcode', android: 'qr_code_2' },
  phone: { ios: 'phone', android: 'call' },
  mail: { ios: 'envelope', android: 'mail' },
  star: { ios: 'star', android: 'star' },
  shield: { ios: 'checkmark.shield', android: 'verified_user' },
  verified: { ios: 'checkmark.seal', android: 'verified' },
  memory: { ios: 'cpu', android: 'memory' },

  // device telemetry
  batteryFull: { ios: 'battery.100percent', android: 'battery_full' },
  batteryHigh: { ios: 'battery.75percent', android: 'battery_5_bar' },
  batteryMid: { ios: 'battery.50percent', android: 'battery_3_bar' },
  batteryLow: { ios: 'battery.25percent', android: 'battery_1_bar' },
  batteryAlert: { ios: 'battery.0percent', android: 'battery_alert' },
  batteryCharging: { ios: 'battery.100percent.bolt', android: 'battery_charging_full' },
  signal: { ios: 'cellularbars', android: 'signal_cellular_alt' },
  signalOff: { ios: 'antenna.radiowaves.left.and.right.slash', android: 'signal_cellular_off' },
  wifi: { ios: 'wifi', android: 'wifi' },
  wifiOff: { ios: 'wifi.slash', android: 'wifi_off' },
  cloudOff: { ios: 'icloud.slash', android: 'cloud_off' },

  // account & settings
  settings: { ios: 'gearshape', android: 'settings' },
  user: { ios: 'person', android: 'person' },
  business: { ios: 'building.2', android: 'storefront' },
  lock: { ios: 'lock', android: 'lock' },
  fingerprint: { ios: 'touchid', android: 'fingerprint' },
  subscription: { ios: 'crown', android: 'workspace_premium' },
  language: { ios: 'globe', android: 'language' },
  darkMode: { ios: 'moon', android: 'dark_mode' },
  lightMode: { ios: 'sun.max', android: 'light_mode' },
  contrast: { ios: 'circle.lefthalf.filled', android: 'contrast' },
  science: { ios: 'flask', android: 'science' },
});

export type IconName = keyof typeof icons;

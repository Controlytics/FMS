export const ICON_MAP: Record<string, string> = {
  box: '\uD83D\uDCE6',
  server: '\uD83D\uDDA5\uFE0F',
  camera: '\uD83D\uDCF9',
  thermometer: '\uD83C\uDF21\uFE0F',
  building: '\uD83C\uDFE2',
  'door-open': '\uD83D\uDEAA',
  truck: '\uD83D\uDE9B',
  wrench: '\uD83D\uDD27',
  shield: '\uD83D\uDEE1\uFE0F',
  monitor: '\uD83D\uDCFA',
  flask: '\uD83E\uDDEA',
  gauge: '\uD83D\uDCCA',
  zap: '\u26A1',
  cpu: '\uD83D\uDDA5\uFE0F',
  fan: '\uD83C\uDF00',
  droplet: '\uD83D\uDCA7',
  wind: '\uD83C\uDF2C\uFE0F',
  beaker: '\uD83E\uDDEA',
};

export const RELATIONSHIP_LABELS: Record<string, string> = {
  CONTAINS: 'Contains',
  CONTAINED_IN: 'Contained In',
  CONNECTED_TO: 'Connected To',
  FEEDS: 'Feeds',
  FED_BY: 'Fed By',
  DEPENDS_ON: 'Depends On',
  DEPENDED_ON_BY: 'Depended On By',
  BACKS_UP: 'Backs Up',
  BACKED_UP_BY: 'Backed Up By',
  MONITORS: 'Monitors',
  MONITORED_BY: 'Monitored By',
  CUSTOM: 'Custom',
};

export const ALL_RELATIONSHIP_TYPES = [
  'CONTAINS',
  'CONTAINED_IN',
  'CONNECTED_TO',
  'FEEDS',
  'FED_BY',
  'DEPENDS_ON',
  'DEPENDED_ON_BY',
  'BACKS_UP',
  'BACKED_UP_BY',
  'MONITORS',
  'MONITORED_BY',
  'CUSTOM',
];

export const IDENTIFIER_TYPE_LABELS: Record<string, string> = {
  QR: 'QR Code',
  BARCODE: 'Barcode',
  RFID: 'RFID',
  NFC: 'NFC',
  MANUAL: 'Manual',
};

export function getIcon(iconKey: string): string {
  return ICON_MAP[iconKey] || '\uD83D\uDCE6';
}

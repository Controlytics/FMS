// ── Section Types ──────────────────────────────────────────────

export type SectionType = 'text' | 'table' | 'chart' | 'key_value' | 'signature' | 'page_break';

export interface ConditionalRule {
  condition: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'between' | 'contains' | 'empty' | 'not_empty';
  value?: string | number;
  min?: number;
  max?: number;
  style: CellStyle;
}

export interface CellStyle {
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  color?: string;
  backgroundColor?: string;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textAlign?: 'left' | 'center' | 'right';
}

export interface ColumnFormat {
  type: 'text' | 'number' | 'datetime';
  decimalPlaces?: number;
  unit?: string;
  pattern?: string;
}

export interface TableColumn {
  key: string;
  header: string;
  width?: string;
  format?: ColumnFormat;
  style?: CellStyle;
  conditionalRules?: ConditionalRule[];
}

export interface TableSettings {
  maxRowsPerPage: number;
  wrapText: boolean;
  showBorders: boolean;
  stripedRows: boolean;
  headerRepeat: boolean;
  emptyValue: string;
  bodyStyle: { fontSize: number; fontFamily: string };
  headerStyle: CellStyle;
}

export interface ChartSeries {
  source: string;
  label: string;
  color: string;
}

export interface ChartAxis {
  type?: 'time' | 'linear' | 'category';
  label: string;
  min?: number;
  max?: number;
}

export interface KVEntry {
  label: string;
  value: string;
  format?: ColumnFormat;
}

export interface SignerDef {
  role: string;
  label: string;
  required: boolean;
}

// ── Section Definitions ────────────────────────────────────────

interface BaseSection {
  id: string;
  type: SectionType;
}

export interface TextSection extends BaseSection {
  type: 'text';
  content: string;
  style: { fontSize: number; fontFamily: string; lineHeight: number };
}

export interface TableSection extends BaseSection {
  type: 'table';
  title: string;
  dataSource: string;
  columns: TableColumn[];
  tableSettings: TableSettings;
}

export interface ChartSection extends BaseSection {
  type: 'chart';
  title: string;
  chartType: 'line' | 'bar' | 'pie';
  width: string;
  height: number;
  dataSeries: ChartSeries[];
  xAxis: ChartAxis;
  yAxis: ChartAxis;
  showLegend: boolean;
  showGrid: boolean;
}

export interface KVSection extends BaseSection {
  type: 'key_value';
  title: string;
  layout: 'one_column' | 'two_column' | 'three_column';
  entries: KVEntry[];
}

export interface SignatureSection extends BaseSection {
  type: 'signature';
  label: string;
  signers: string[];
}

export interface PageBreakSection extends BaseSection {
  type: 'page_break';
}

export type Section = TextSection | TableSection | ChartSection | KVSection | SignatureSection | PageBreakSection;

// ── Header / Footer ───────────────────────────────────────────

export interface HeaderFooterElement {
  type: 'text' | 'image';
  content?: string;
  source?: string;
  position: 'left' | 'center' | 'right';
  width?: number;
  style?: { fontSize?: number; fontWeight?: string; color?: string };
}

export interface HeaderFooterConfig {
  enabled: boolean;
  height: number;
  elements: HeaderFooterElement[];
}

// ── Entity Slots ──────────────────────────────────────────────

export interface EntitySlot {
  name: string;
  label: string;
  type: 'asset_instance' | 'equipment_group' | 'uns_path';
  templateFilter?: string;
  pathPrefix?: string;
}

// ── Signature Config ──────────────────────────────────────────

export interface SignatureConfig {
  required: boolean;
  meaning: string;
  signers: SignerDef[];
}

// ── Page Settings ─────────────────────────────────────────────

export interface PageSettings {
  size: 'A4' | 'Letter' | 'Legal';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
}

// ── Full Template Config ──────────────────────────────────────

export interface TemplateConfig {
  pageSettings: PageSettings;
  header: HeaderFooterConfig;
  footer: HeaderFooterConfig;
  entitySlots: EntitySlot[];
  sections: Section[];
  signatureConfig: SignatureConfig;
}

// ── Defaults ──────────────────────────────────────────────────

let counter = 0;
export function genId(): string {
  return `sec_${Date.now()}_${++counter}`;
}

export function createDefaultSection(type: SectionType): Section {
  const id = genId();
  switch (type) {
    case 'text':
      return { id, type, content: '', style: { fontSize: 12, fontFamily: 'Arial', lineHeight: 1.5 } };
    case 'table':
      return {
        id, type, title: 'Data Table', dataSource: '', columns: [],
        tableSettings: {
          maxRowsPerPage: 30, wrapText: true, showBorders: true, stripedRows: true,
          headerRepeat: true, emptyValue: '\u2014',
          bodyStyle: { fontSize: 10, fontFamily: 'Arial' },
          headerStyle: { fontWeight: 'bold', backgroundColor: '#f1f5f9', textTransform: 'uppercase' },
        },
      };
    case 'chart':
      return {
        id, type, title: 'Chart', chartType: 'line', width: '100%', height: 300,
        dataSeries: [], xAxis: { type: 'time', label: 'Time' }, yAxis: { label: 'Value' },
        showLegend: true, showGrid: true,
      };
    case 'key_value':
      return { id, type, title: 'Details', layout: 'two_column', entries: [] };
    case 'signature':
      return { id, type, label: 'Electronic Signature', signers: [] };
    case 'page_break':
      return { id, type };
  }
}

export const SECTION_LABELS: Record<SectionType, string> = {
  text: 'Text Block',
  table: 'Data Table',
  chart: 'Chart',
  key_value: 'Key-Value',
  signature: 'Signature',
  page_break: 'Page Break',
};

export const SECTION_ICONS: Record<SectionType, string> = {
  text: 'Type',
  table: 'Table2',
  chart: 'BarChart3',
  key_value: 'List',
  signature: 'PenTool',
  page_break: 'SeparatorHorizontal',
};

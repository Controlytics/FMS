import { describe, it, expect } from 'vitest';
import { renderChart } from '../chart-renderer.js';

const baseConfig = (overrides: Partial<Parameters<typeof renderChart>[0]> = {}) => ({
  chartType: 'line' as const,
  title: 'Test',
  width: '800',
  height: 400,
  dataSeries: [{ source: 'series1', label: 'Series 1', color: '#3b82f6' }],
  xAxis: { type: 'linear', label: 'X' },
  yAxis: { label: 'Y' },
  showLegend: true,
  showGrid: true,
  ...overrides,
});

const sampleRows = [
  { x: 1, value: 10 },
  { x: 2, value: 20 },
  { x: 3, value: 15 },
];

const resolveSeries = (source: string, rows: Array<{ x: number; value: number }>) => {
  const map = new Map<string, unknown>();
  map.set(source, rows);
  return map;
};

describe('renderChart', () => {
  it('renders a line chart and returns a non-empty PNG data URL', async () => {
    const result = await renderChart(baseConfig(), resolveSeries('series1', sampleRows));
    expect(result).toMatch(/^data:image\/png;base64,.+$/);
    const base64 = result.split(',')[1];
    expect(Buffer.from(base64, 'base64').length).toBeGreaterThan(500);
  });

  it('renders a bar chart', async () => {
    const result = await renderChart(
      baseConfig({ chartType: 'bar' }),
      resolveSeries('series1', sampleRows),
    );
    expect(result).toMatch(/^data:image\/png;base64,.+$/);
    expect(Buffer.from(result.split(',')[1], 'base64').length).toBeGreaterThan(500);
  });

  it('renders a pie chart', async () => {
    const result = await renderChart(
      baseConfig({
        chartType: 'pie',
        dataSeries: [
          { source: 'series1', label: 'Slice A', color: '#3b82f6' },
          { source: 'series2', label: 'Slice B', color: '#ef4444' },
        ],
      }),
      new Map<string, unknown>([
        ['series1', [{ x: 'A', value: 30 }]],
        ['series2', [{ x: 'B', value: 70 }]],
      ]),
    );
    expect(result).toMatch(/^data:image\/png;base64,.+$/);
    expect(Buffer.from(result.split(',')[1], 'base64').length).toBeGreaterThan(500);
  });

  it('PNG output starts with the PNG signature bytes', async () => {
    const result = await renderChart(baseConfig(), resolveSeries('series1', sampleRows));
    const buf = Buffer.from(result.split(',')[1], 'base64');
    // PNG file signature: 89 50 4E 47 0D 0A 1A 0A
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});

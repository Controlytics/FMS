import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';

Chart.register(...registerables);

interface ChartSeries {
  source: string;
  label: string;
  color: string;
}

interface ChartAxis {
  type?: string;
  label: string;
  min?: number;
  max?: number;
}

interface ChartSectionConfig {
  chartType: 'line' | 'bar' | 'pie';
  title: string;
  width: string;
  height: number;
  dataSeries: ChartSeries[];
  xAxis: ChartAxis;
  yAxis: ChartAxis;
  showLegend: boolean;
  showGrid: boolean;
}

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 400;

export async function renderChart(
  config: ChartSectionConfig,
  resolvedSeries: Map<string, unknown>,
): Promise<string> {
  const datasets = config.dataSeries.map((series) => {
    const data = resolvedSeries.get(series.source);
    const rows = Array.isArray(data) ? data : [];

    return {
      label: series.label,
      data: rows.map((row: { timestamp?: unknown; time?: unknown; x?: unknown; value?: unknown; y?: unknown; value_num?: unknown }) => ({
        x: row.timestamp ?? row.time ?? row.x,
        y: row.value ?? row.y ?? row.value_num,
      })),
      borderColor: series.color,
      backgroundColor:
        config.chartType === 'pie'
          ? config.dataSeries.map((s) => s.color)
          : `${series.color}33`,
      fill: config.chartType === 'line',
      tension: 0.3,
    };
  });

  const width = Number.isFinite(Number(config.width)) ? Number(config.width) : DEFAULT_WIDTH;
  const height = config.height || DEFAULT_HEIGHT;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // White background — chart.js leaves the canvas transparent by default,
  // PDF embedders expect an opaque image.
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);

  const chartConfig = {
    type: config.chartType,
    data: { datasets },
    options: {
      responsive: false,
      animation: false as const,
      plugins: {
        title: { display: !!config.title, text: config.title, font: { size: 14 } },
        legend: { display: config.showLegend },
      },
      scales:
        config.chartType !== 'pie'
          ? {
              x: {
                type: config.xAxis.type === 'time' ? 'time' : 'linear',
                title: { display: !!config.xAxis.label, text: config.xAxis.label },
                grid: { display: config.showGrid },
              },
              y: {
                title: { display: !!config.yAxis.label, text: config.yAxis.label },
                min: config.yAxis.min,
                max: config.yAxis.max,
                grid: { display: config.showGrid },
              },
            }
          : undefined,
    },
  };

  // chart.js types expect a DOM CanvasRenderingContext2D; @napi-rs/canvas
  // implements the same surface but TypeScript can't see the structural
  // equivalence, hence the cast.
  const chart = new Chart(ctx as unknown as CanvasRenderingContext2D, chartConfig as never);

  try {
    chart.update();
    chart.draw();
    const buffer = canvas.toBuffer('image/png');
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } finally {
    chart.destroy();
  }
}

// Exposed for tests and for app-level cleanup hooks. @napi-rs/canvas does
// not require explicit shutdown, but keeping a symmetric API with
// pdf-renderer's closeBrowser simplifies callers.
export async function shutdownChartRenderer(): Promise<void> {
  // Reserved for future font-cache or worker pool cleanup.
  void GlobalFonts;
}

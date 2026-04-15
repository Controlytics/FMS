import { ChartJSNodeCanvas } from 'chartjs-node-canvas';

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

const chartCanvas = new ChartJSNodeCanvas({
  width: 800,
  height: 400,
  backgroundColour: 'white',
});

export async function renderChart(
  config: ChartSectionConfig,
  resolvedSeries: Map<string, unknown>,
): Promise<string> {
  const datasets = config.dataSeries.map(series => {
    const data = resolvedSeries.get(series.source);
    const rows = Array.isArray(data) ? data : [];

    return {
      label: series.label,
      data: rows.map((row: any) => ({
        x: row.timestamp ?? row.time ?? row.x,
        y: row.value ?? row.y ?? row.value_num,
      })),
      borderColor: series.color,
      backgroundColor: config.chartType === 'pie'
        ? config.dataSeries.map(s => s.color)
        : `${series.color}33`,
      fill: config.chartType === 'line',
      tension: 0.3,
    };
  });

  const chartConfig: any = {
    type: config.chartType,
    data: {
      datasets,
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: !!config.title, text: config.title, font: { size: 14 } },
        legend: { display: config.showLegend },
      },
      scales: config.chartType !== 'pie' ? {
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
      } : undefined,
    },
  };

  const buffer = await chartCanvas.renderToBuffer(chartConfig);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

type LineChartPoint = {
  label: string
  value: number
}

type LineChartProps = {
  data: LineChartPoint[]
  emptyLabel?: string
}

export function LineChart({ data, emptyLabel }: LineChartProps) {
  if (data.length === 0) {
    return <div className="chart-empty">{emptyLabel ?? 'No data'}</div>
  }

  const maxValue = Math.max(...data.map((point) => point.value), 1)
  const width = 100
  const height = 100
  const padding = 10
  const range = height - padding * 2

  const getX = (index: number) =>
    data.length === 1
      ? width / 2
      : padding + (index / (data.length - 1)) * (width - padding * 2)
  const getY = (value: number) => height - padding - (value / maxValue) * range

  const points = data.map((point, index) => ({
    x: getX(index),
    y: getY(point.value),
  }))

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path className="line-chart-area" d={areaPath} />
        <path className="line-chart-line" d={linePath} />
      </svg>
      <div className="line-chart-labels">
        {data.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  )
}

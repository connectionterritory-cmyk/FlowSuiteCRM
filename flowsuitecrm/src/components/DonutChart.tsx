type DonutSlice = {
  label: string
  value: number
  color: string
}

type DonutChartProps = {
  data: DonutSlice[]
  emptyLabel?: string
}

export function DonutChart({ data, emptyLabel }: DonutChartProps) {
  const total = data.reduce((acc, item) => acc + item.value, 0)
  if (total === 0) {
    return <div className="chart-empty">{emptyLabel ?? 'No data'}</div>
  }

  const segments = data.reduce<{ nextAngle: number; values: string[] }>((acc, slice) => {
    const angle = (slice.value / total) * 360
    const start = acc.nextAngle
    const end = start + angle
    acc.values.push(`${slice.color} ${start}deg ${end}deg`)
    return { nextAngle: end, values: acc.values }
  }, { nextAngle: 0, values: [] }).values

  return (
    <div className="donut-wrapper">
      <div className="donut" style={{ background: `conic-gradient(${segments.join(', ')})` }} />
      <div className="donut-legend">
        {data.map((slice) => {
          const percent = total > 0 ? Math.round((slice.value / total) * 100) : 0
          return (
            <div key={slice.label} className="legend-item">
              <span className="legend-swatch" style={{ background: slice.color }} />
              <div className="legend-text">
                <span>{slice.label}</span>
                <strong>{slice.value} ({percent}%)</strong>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

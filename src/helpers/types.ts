export interface FancyZonesPlace {
  monitor: number
  position: number
}

export interface WindowRule {
  titleMatch?: string
  pathMatch?: string
  fancyZones: FancyZonesPlace
  desktop?: number
  window?: ['current'|number] // apply to current window
  pin?: boolean
  single?: boolean // only first 'single' rule will be executed

  x?: number,
  y?: number,
  width?: number,
  height?: number,
}

import fs from 'node:fs';
import { getConfig } from './config.js';
import { getFancyZoneMonitor } from './monitors.js';

function getFancyZoneInfo(opts) {
  let monitor, layout, zone;
  const config = getConfig();
  if (!opts.monitor) { console.log('fancyZones.monitor is required'); return false; }
  if (!opts.position) { console.log('fancyZones.position is required'); return false; }
  monitor = getFancyZoneMonitor(opts.monitor);
  const appliedLayouts = JSON.parse(fs.readFileSync(`${config.fancyZones.path}/applied-layouts.json`, 'utf8'))['applied-layouts'];
  const customLayouts = JSON.parse(fs.readFileSync(`${config.fancyZones.path}/custom-layouts.json`, 'utf8'))['custom-layouts'];
  if (monitor !== undefined) {
    const applied = appliedLayouts.find(lay => lay.device.monitor === monitor.monitor);
    if (!applied) { console.log(`layout not found: ${opts}`); return false; }
    if (applied['applied-layout'].type === 'custom') {
      layout = customLayouts.find(lay => lay.uuid === applied['applied-layout'].uuid);
    } else {
      console.log(`fancyZonesToPos(${opts}): only custom zone sets supported, don't use layout templates!`);
    }
    if (!layout) return false;
    zone = layout.info.zones[opts.position - 1];
  }
  if (!zone) {
    const backup = config.positionsMap.find(p => p.from.monitor === opts.monitor && p.from.position === opts.position);
    if (backup) {
      const res = getFancyZoneInfo(backup.to);
      if (!res || !res.monitor || !res.layout || !res.zone) return false;
      monitor = res.monitor;
      layout = res.layout;
      zone = res.zone;
    }
  }
  return { monitor, layout, zone };
}

function fancyZonesToPos(opts) {
  const { monitor, zone } = getFancyZoneInfo(opts);
  if (!zone) {
    console.log(`Zone not found: ${JSON.stringify(opts)}`);
    return;
  }
  const monBounds = {
    x: monitor['left-coordinate'],
    y: monitor['top-coordinate'],
    width: monitor['work-area-width'],
    height: monitor['work-area-height'],
  };

  const pos = {
    x: monBounds.x + zone.X,
    y: monBounds.y + zone.Y,
    width: zone.width,
    height: zone.height,
  };

  applyMonitorGaps({ pos, monBounds, opts });

  return pos;
}

function applyMonitorGaps({ pos, monBounds, opts }) {
  const config = getConfig();
  const monitorGaps = config?.monitorsGaps?.[opts.monitor];
  if (!monitorGaps) return;

  const gaps = Array.isArray(monitorGaps) ? monitorGaps : [monitorGaps];
  for (const gap of gaps) {
    if (!gap || typeof gap.gap !== 'number' || gap.gap <= 0) continue;
    const overlap = getGapOverlap({ pos, monBounds, gap });
    if (!overlap) continue;

    if (gap.position === 'bottom') {
      pos.height = Math.max(0, pos.height - overlap.height);
    } else if (gap.position === 'top') {
      pos.y += overlap.height;
      pos.height = Math.max(0, pos.height - overlap.height);
    } else if (gap.position === 'left') {
      pos.x += overlap.width;
      pos.width = Math.max(0, pos.width - overlap.width);
    } else if (gap.position === 'right') {
      pos.width = Math.max(0, pos.width - overlap.width);
    }
  }
}

function getGapOverlap({ pos, monBounds, gap }) {
  const gapBounds = getGapBounds({ monBounds, gap });
  if (!gapBounds) return;

  const x1 = Math.max(pos.x, gapBounds.x);
  const y1 = Math.max(pos.y, gapBounds.y);
  const x2 = Math.min(pos.x + pos.width, gapBounds.x + gapBounds.width);
  const y2 = Math.min(pos.y + pos.height, gapBounds.y + gapBounds.height);

  if (x2 <= x1 || y2 <= y1) return;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function getGapBounds({ monBounds, gap }) {
  const gapSize = gap.gap;
  switch (gap.position) {
    case 'bottom':
      return {
        x: monBounds.x,
        y: monBounds.y + monBounds.height - gapSize,
        width: monBounds.width,
        height: gapSize,
      };
    case 'top':
      return {
        x: monBounds.x,
        y: monBounds.y,
        width: monBounds.width,
        height: gapSize,
      };
    case 'left':
      return {
        x: monBounds.x,
        y: monBounds.y,
        width: gapSize,
        height: monBounds.height,
      };
    case 'right':
      return {
        x: monBounds.x + monBounds.width - gapSize,
        y: monBounds.y,
        width: gapSize,
        height: monBounds.height,
      };
    default:
      return undefined;
  }
}

function addFancyZoneHistory({ w, rule }) {
  const config = getConfig();
  if (!config.fancyZones?.enabled) return;
  const historyPath = `${config.fancyZones.path}/app-zone-history.json`;
  let history;
  try {
    history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch (e) {
    history = { 'app-zone-history': [] };
  }
  if (!Array.isArray(history['app-zone-history'])) {
    history['app-zone-history'] = [];
  }

  const list = history['app-zone-history'];
  const idx = list.findIndex(item => item['app-path']?.toLowerCase() === w.path.toLowerCase());
  if (idx !== -1) list.splice(idx, 1);

  const info = getFancyZoneInfo(rule.fancyZones);
  if (!info.monitor || !info.layout) {
    fs.writeFileSync(historyPath, JSON.stringify(history));
    return;
  }

  const device = {
    monitor: info.monitor.monitor,
    'monitor-instance': info.monitor['monitor-instance'],
    'serial-number': info.monitor['serial-number'],
    'monitor-number': info.monitor['monitor-number'],
    'virtual-desktop': info.monitor['virtual-desktop'],
  };

  const entry = {
    'app-path': w.path,
    history: [
      {
        'zone-index-set': [rule.fancyZones.position - 1],
        device,
        'zoneset-uuid': info.layout.uuid,
      },
    ],
  };

  list.push(entry);
  fs.writeFileSync(historyPath, JSON.stringify(history));
}

export { getFancyZoneMonitor, getFancyZoneInfo, fancyZonesToPos, addFancyZoneHistory };

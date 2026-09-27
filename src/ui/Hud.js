import { pressureAt, progressToMetres, temperatureAt, zoneAt } from '../config.js';

/** Dive telemetry: zone, depth gauge and readouts derived from the smoothed dive progress. */
export class Hud {
  constructor(root) {
    this.root = root;
    this.zoneEl = root.querySelector('.hud__zone');
    this.zoneIndex = root.querySelector('.hud__zone-index');
    this.zoneName = root.querySelector('.hud__zone-name');
    this.track = root.querySelector('.gauge__track');
    this.depth = root.querySelector('.readout__depth');
    this.pressure = root.querySelector('.readout__pressure');
    this.temp = root.querySelector('.readout__temp');
    this.zone = null;
    this.values = {};
    this.zoneListeners = new Set();
  }

  onZoneChange(listener) {
    this.zoneListeners.add(listener);
  }

  write(key, element, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    element.textContent = value;
  }

  update(progress) {
    const metres = progressToMetres(progress);
    this.write('depth', this.depth, Math.round(metres).toLocaleString('en-US'));
    this.write('pressure', this.pressure, Math.round(pressureAt(metres)).toLocaleString('en-US'));
    this.write('temp', this.temp, temperatureAt(metres).toFixed(1));
    this.track.style.setProperty('--p', progress.toFixed(4));

    const zone = zoneAt(progress);
    if (zone !== this.zone) {
      const first = this.zone === null;
      this.zone = zone;
      clearTimeout(this.zoneTimer);
      if (first) {
        this.zoneIndex.textContent = zone.index;
        this.zoneName.textContent = zone.name;
        return;
      }
      this.zoneEl.classList.add('is-changing');
      this.zoneTimer = setTimeout(() => {
        this.zoneIndex.textContent = zone.index;
        this.zoneName.textContent = zone.name;
        this.zoneEl.classList.remove('is-changing');
      }, 350);
      this.zoneListeners.forEach((listener) => listener(zone));
    }
  }

  dispose() {
    clearTimeout(this.zoneTimer);
    this.zoneListeners.clear();
  }
}

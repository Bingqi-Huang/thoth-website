import { Run } from "./types";

type Box = [[number, number, number], [number, number, number]];
const SHOW: [string, string][] = [
  ["rover_charging_station", "Dock"], ["pdu_1", "PDU-1"], ["pdu_2", "PDU-2"], ["pdu_3", "PDU-3"], ["bess", "BESS"],
  ["isru_tank_skid", "ISRU"], ["habitat_row", "Habitat"], ["pv_rack_1", ""], ["pv_rack_2", ""], ["pv_tracker_1", ""],
  ["pv_tracker_2", ""], ["pv_tracker_3", ""], ["ring_main_unit", ""], ["cargo_carrier", ""], ["crew_rover_parked", ""],
  ["exomars_parked", ""], ["isru_rassor", ""], ["isru_cable_reels", ""], ["comm_dish", ""], ["comm_radome", ""],
  ["depot_spares_stand", ""], ["depot_stand", "Depot"], ["landing_stand", "Landing"], ["habitat_stand", ""],
  ["return_stand", ""], ["bess_stand", ""], ["isru_stand", ""], ["isru_return_stand", ""],
];
const NS = "http://www.w3.org/2000/svg";

let bounds: Record<string, Box> | null = null;
export async function loadBounds() { bounds = await (await fetch("data/site_bounds.json")).json(); }

export class Minimap {
  svg: SVGSVGElement;
  run: Run | null = null;
  trail!: SVGPolylineElement;
  rover!: SVGGElement;
  held!: SVGCircleElement;
  constructor(svg: SVGSVGElement) { this.svg = svg; }

  setRun(run: Run) {
    this.run = run;
    const b = bounds!;
    const xs: number[] = [], ys: number[] = [];
    for (const p of run.track) { xs.push(p[1]); ys.push(p[2]); }
    for (const k of ["rover_charging_station", "pdu_1", "pdu_3"]) { xs.push(b[k][0][0], b[k][1][0]); ys.push(b[k][0][1], b[k][1][1]); }
    let x0 = Math.min(...xs) - 5, x1 = Math.max(...xs) + 5, y0 = Math.min(...ys) - 5, y1 = Math.max(...ys) + 5;
    const s = Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    x0 = cx - s / 2; y0 = cy - s / 2;
    // world (x right, y up) -> svg (y down)
    this.svg.setAttribute("viewBox", `${x0} ${-(y0 + s)} ${s} ${s}`);
    const k = s / 100;
    let html = "";
    for (const [name, label] of SHOW) {
      const bx = b[name];
      if (!bx) continue;
      const [[ax, ay], [bxx, byy]] = [bx[0], bx[1]];
      html += `<rect class="fp${label ? " key" : ""}" x="${ax}" y="${-byy}" width="${bxx - ax}" height="${byy - ay}" rx="${0.3 * k}" stroke-width="${0.25 * k}"/>`;
      if (label) html += `<text class="lbl" x="${(ax + bxx) / 2}" y="${-ay + 4.2 * k}" text-anchor="middle" font-size="${4.6 * k}">${label}</text>`;
    }
    const all = run.track.map(p => `${p[1]},${-p[2]}`).join(" ");
    html += `<polyline class="future" points="${all}" stroke-width="${0.35 * k}" stroke-dasharray="${k} ${k}"/>`;
    html += `<polyline class="trail" points="" stroke-width="${0.6 * k}"/>`;
    html += `<circle class="held" r="${1.1 * k}" visibility="hidden"/>`;
    html += `<g class="rover"><path d="M ${2.2 * k} 0 L ${-1.4 * k} ${1.4 * k} L ${-0.8 * k} 0 L ${-1.4 * k} ${-1.4 * k} Z"/></g>`;
    this.svg.innerHTML = html;
    this.trail = this.svg.querySelector(".trail")!;
    this.rover = this.svg.querySelector(".rover")!;
    this.held = this.svg.querySelector(".held")!;
  }

  update(t: number) {
    const tr = this.run?.track;
    if (!tr || !tr.length) return;
    let lo = 0, hi = tr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tr[m][0] <= t) lo = m + 1; else hi = m; }
    const i = Math.max(0, lo - 1), p = tr[i];
    const pts: string[] = [];
    const step = Math.max(1, Math.floor(i / 600));
    for (let j = 0; j <= i; j += step) pts.push(`${tr[j][1]},${-tr[j][2]}`);
    pts.push(`${p[1]},${-p[2]}`);
    this.trail.setAttribute("points", pts.join(" "));
    this.rover.setAttribute("transform", `translate(${p[1]} ${-p[2]}) rotate(${(-p[3] * 180) / Math.PI})`);
    this.held.setAttribute("visibility", p[4] ? "visible" : "hidden");
    this.held.setAttribute("cx", String(p[1])); this.held.setAttribute("cy", String(-p[2]));
  }
}

export { NS };

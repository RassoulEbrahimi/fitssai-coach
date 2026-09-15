#!/usr/bin/env node
/**
 * Exercise thumbnail pack generator (TRAINING-UI-01B).
 *
 * Writes the original local vector artwork in src/assets/exercise-thumbnails.
 * The SVG files are the shipped artefacts; this script exists so the pack keeps
 * one visual language when a movement is revised or a new one is added.
 *
 * Style contract — also documented in docs/TRAINING-UI-01B-thumbnail-assets.md:
 * - 72x72 viewBox, so one unit is one CSS pixel at the rendered size.
 * - Safe area 6..66. Transparent background, no text, no external references.
 * - Pictogram figure: filled head, 6.6-unit torso, 4.6-unit limbs, round caps.
 *   The far arm and leg are one step lighter, which is the only depth cue.
 * - Equipment is thinner (2.6) and lighter; pads are outlined light fills.
 * - The accent green marks the moving load only (plates, dumbbells, handles).
 * - Authored for the light surface. ExerciseThumbnail inverts in dark mode.
 *
 * Usage: node scripts/generate-exercise-thumbnails.mjs [outDir]
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? join(HERE, '..', 'src', 'assets', 'exercise-thumbnails');

const INK = '#27272a';
const FAR = '#52525b';
const EQ = '#71717a';
const PAD = '#d4d4d8';
const ACC = '#16a34a';

const LIMB = 4.6;
const TORSO_W = 6.6;
const EQ_W = 2.6;
const CABLE_W = 2;
const FLOOR = 64;
const GROUND = 61.4;

/** Segment lengths of the shared figure. */
const L = { torso: 14, upper: 9.5, fore: 8.5, thigh: 13, shin: 13, neck: 6.5, head: 4.3 };

const rad = (deg) => (deg * Math.PI) / 180;
const n = (value) => Math.round(value * 10) / 10;
const P = (from, len, deg) => [from[0] + len * Math.cos(rad(deg)), from[1] + len * Math.sin(rad(deg))];
const chain = (start, ...segments) =>
  segments.reduce((points, [len, deg]) => [...points, P(points[points.length - 1], len, deg)], [start]);
const mirror = (point) => [72 - point[0], point[1]];
const between = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

class Scene {
  constructor() {
    this.parts = [];
  }

  raw(markup) {
    this.parts.push(markup);
    return this;
  }

  line(points, { stroke = INK, width = LIMB } = {}) {
    const d = points.map(([x, y], index) => `${index ? 'L' : 'M'}${n(x)} ${n(y)}`).join('');
    return this.raw(`<path d="${d}" stroke="${stroke}" stroke-width="${width}"/>`);
  }

  curve(from, control, to, { stroke = EQ, width = EQ_W } = {}) {
    return this.raw(
      `<path d="M${n(from[0])} ${n(from[1])}Q${n(control[0])} ${n(control[1])} ${n(to[0])} ${n(to[1])}" stroke="${stroke}" stroke-width="${width}"/>`,
    );
  }

  circle([cx, cy], r, { fill = 'none', stroke, width = EQ_W } = {}) {
    const paint = `${fill === 'none' ? '' : ` fill="${fill}"`}${stroke ? ` stroke="${stroke}" stroke-width="${width}"` : ''}`;
    return this.raw(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${paint}/>`);
  }

  rect(x, y, w, h, { rx = 1.4, fill = ACC, stroke, width = EQ_W } = {}) {
    const paint = `${fill === 'none' ? '' : ` fill="${fill}"`}${stroke ? ` stroke="${stroke}" stroke-width="${width}"` : ''}`;
    return this.raw(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${rx}"${paint}/>`);
  }

  /** Ground contact. Everything standing shares one line, so scale reads the same. */
  floor(x1 = 7, x2 = 65, y = FLOOR) {
    return this.line([[x1, y], [x2, y]], { stroke: EQ, width: EQ_W });
  }

  /** A padded surface: an equipment-coloured body with a lighter inlay. */
  pad(points, { w = 7 } = {}) {
    this.line(points, { stroke: EQ, width: w });
    return this.line(points, { stroke: PAD, width: w - 3.4 });
  }

  /** A flat bench seen from the side. */
  bench(x1, x2, y, { legs = true } = {}) {
    this.pad([[x1, y], [x2, y]]);
    if (legs) {
      this.line([[x1 + 4, y + 2], [x1 + 4, FLOOR]], { stroke: EQ, width: EQ_W });
      this.line([[x2 - 4, y + 2], [x2 - 4, FLOOR]], { stroke: EQ, width: EQ_W });
    }
    return this;
  }

  /** A barbell seen end on: the plate the lifter is under. */
  plate(center, r = 6.2) {
    this.circle(center, r, { fill: ACC });
    return this.circle(center, 1.5, { fill: PAD });
  }

  /** A barbell seen from the front, with a plate stack at each end. */
  barbell(y, x1, x2, { ph = 12, pw = 4 } = {}) {
    this.line([[x1, y], [x2, y]], { stroke: EQ, width: EQ_W });
    this.rect(x1, y - ph / 2, pw, ph, { rx: 1.4 });
    return this.rect(x2 - pw, y - ph / 2, pw, ph, { rx: 1.4 });
  }

  /** A dumbbell: the bar with a head at each end. */
  dumbbell(center, { vertical = false, half = 4.6, head = 6.2, thick = 3.2 } = {}) {
    const [cx, cy] = center;
    if (vertical) {
      this.line([[cx, cy - half], [cx, cy + half]], { stroke: ACC, width: 2.6 });
      this.rect(cx - head / 2, cy - half - thick, head, thick, { rx: 1.2 });
      return this.rect(cx - head / 2, cy + half, head, thick, { rx: 1.2 });
    }
    this.line([[cx - half, cy], [cx + half, cy]], { stroke: ACC, width: 2.6 });
    this.rect(cx - half - thick, cy - head / 2, thick, head, { rx: 1.2 });
    return this.rect(cx + half, cy - head / 2, thick, head, { rx: 1.2 });
  }

  /** A cable tower: the upright with a pulley. */
  column(x, { top = 7, bottom = FLOOR, pulley } = {}) {
    this.line([[x, top], [x, bottom]], { stroke: EQ, width: 3 });
    if (pulley !== undefined) this.circle([x, pulley], 2.4, { stroke: EQ, width: 2 });
    return this;
  }

  cable(points) {
    return this.line(points, { stroke: EQ, width: CABLE_W });
  }

  /** A cable handle, held in one or both hands. */
  handle(center, { vertical = true, len = 8 } = {}) {
    const [cx, cy] = center;
    const points = vertical
      ? [[cx, cy - len / 2], [cx, cy + len / 2]]
      : [[cx - len / 2, cy], [cx + len / 2, cy]];
    return this.line(points, { stroke: ACC, width: 3.4 });
  }

  person(pose) {
    const { hip, sh, head, armN, armF, legN, legF } = pose;
    if (legF) this.line(legF, { stroke: FAR });
    if (armF) this.line(armF, { stroke: FAR });
    this.line([hip, sh], { stroke: INK, width: TORSO_W });
    this.circle(head, L.head, { fill: INK });
    if (legN) this.line(legN, { stroke: INK });
    if (armN) this.line(armN, { stroke: INK });
    return this;
  }

  render() {
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="72" height="72" fill="none" stroke-linecap="round" stroke-linejoin="round">',
      ...this.parts,
      '</svg>',
      '',
    ].join('\n');
  }
}

/** A limb is either two angles or two explicit joints. */
const limb = (start, spec, l1, l2) =>
  Array.isArray(spec[0]) ? [start, ...spec] : chain(start, [l1, spec[0]], [l2, spec[1]]);

/** Side view: the torso angle drives the shoulder and head. */
function sidePose({ hip, torso = -90, neck, arm = [90, 90], armFar, leg = [90, 90], legFar, s = 1 }) {
  const sh = P(hip, L.torso * s, torso);
  const head = P(sh, L.neck * s, neck ?? torso);
  return {
    hip,
    sh,
    head,
    armN: limb(sh, arm, L.upper * s, L.fore * s),
    armF: limb(sh, armFar ?? arm, L.upper * s, L.fore * s),
    legN: limb(hip, leg, L.thigh * s, L.shin * s),
    legF: limb(hip, legFar ?? leg, L.thigh * s, L.shin * s),
  };
}

/** Front view: joints are explicit, because limbs foreshorten. */
function frontPose({ hip, sh, head, armL, armR, legL, legR }) {
  return {
    hip,
    sh,
    head: head ?? [sh[0], sh[1] - L.neck],
    armN: armR && [[sh[0] + 4.5, sh[1] + 1], ...armR],
    armF: armL && [[sh[0] - 4.5, sh[1] + 1], ...armL],
    legN: legR && [[hip[0] + 2.5, hip[1]], ...legR],
    legF: legL && [[hip[0] - 2.5, hip[1]], ...legL],
  };
}

/** Both front-view limbs are near the camera, so they share the ink colour. */
function frontPerson(scene, pose) {
  const { hip, sh, head, armN, armF, legN, legF } = pose;
  if (legF) scene.line(legF, { stroke: INK });
  if (armF) scene.line(armF, { stroke: INK });
  scene.line([hip, sh], { stroke: INK, width: TORSO_W });
  scene.circle(head, L.head, { fill: INK });
  if (legN) scene.line(legN, { stroke: INK });
  if (armN) scene.line(armN, { stroke: INK });
  return scene;
}

const scenes = {
  // ---------------------------------------------------------------- chest ---
  'bench-press'(s) {
    s.floor();
    s.bench(12, 48, 43);
    const p = sidePose({
      hip: [35, 39.5], torso: 180,
      arm: [-90, -93], armFar: [-84, -99],
      leg: [40, 95], legFar: [32, 103],
    });
    s.person(p);
    s.plate([p.armN[2][0], p.armN[2][1] - 1.5]);
  },

  'close-grip-bench-press'(s) {
    // Seen from the head end, the only view where grip width is visible.
    s.floor(20, 52);
    s.line([[28, 62], [44, 62]], { stroke: EQ, width: EQ_W });
    s.line([[36, 47], [36, 62]], { stroke: EQ, width: EQ_W });
    s.pad([[26, 45], [46, 45]], { w: 9 });
    s.line([[27, 41], [45, 41]], { stroke: INK, width: TORSO_W });
    s.circle([36, 33.5], L.head, { fill: INK });
    s.line([[29, 41], [25, 31], [32, 21]], { stroke: INK });
    s.line([[43, 41], [47, 31], [40, 21]], { stroke: INK });
    s.barbell(18, 11, 61);
  },

  'incline-bench-press'(s) {
    s.floor();
    s.pad([[30, 47], [45, 47]]);
    s.pad([[27, 45], [14, 26]]);
    s.line([[41, 49], [41, FLOOR]], { stroke: EQ, width: EQ_W });
    s.line([[20, 34], [26, FLOOR]], { stroke: EQ, width: EQ_W });
    const p = sidePose({
      hip: [32, 42], torso: -124,
      arm: [-80, -100], armFar: [-72, -108],
      leg: [18, 88], legFar: [10, 96],
    });
    s.person(p);
    s.plate([p.armN[2][0], p.armN[2][1] - 1], 5.8);
  },

  'incline-smith-bench-press'(s) {
    s.floor();
    // The guide rail the bar is fixed to, and the frame it runs in.
    s.line([[24, 8], [24, FLOOR]], { stroke: EQ, width: EQ_W });
    s.line([[13, 9], [35, 9]], { stroke: EQ, width: EQ_W });
    s.pad([[30, 47], [45, 47]]);
    s.pad([[27, 45], [14, 26]]);
    s.line([[41, 49], [41, FLOOR]], { stroke: EQ, width: EQ_W });
    const p = sidePose({
      hip: [32, 42], torso: -124,
      arm: [[26, 21.5], [24, 13]], armFar: [[29, 22], [24.5, 13.5]],
      leg: [18, 88], legFar: [10, 96],
    });
    s.person(p);
    s.plate([24, 13], 5.4);
  },

  'push-up'(s) {
    s.floor();
    const p = sidePose({
      hip: [34.6, 49.2], torso: -26.6,
      arm: [[48, 51], [48, GROUND]], armFar: [[45.5, 51], [45.5, GROUND]],
      leg: [153, 153], legFar: [157, 157],
    });
    s.person(p);
  },

  butterfly(s) {
    // Pec deck: elbows on vertical pads, arms closing in front of the chest.
    s.pad([[36, 20], [36, 46]], { w: 11 });
    s.pad([[26, 49], [46, 49]]);
    s.line([[36, 51], [36, FLOOR]], { stroke: EQ, width: EQ_W });
    const p = frontPose({
      hip: [36, 46], sh: [36, 32],
      armL: [[22, 33], [22, 23]], armR: [[50, 33], [50, 23]],
      legL: [[30, 52], [30, GROUND]], legR: [[42, 52], [42, GROUND]],
    });
    frontPerson(s, p);
    s.rect(19.4, 21, 5.2, 14, { rx: 2.4 });
    s.rect(47.4, 21, 5.2, 14, { rx: 2.4 });
  },

  dips(s) {
    s.line([[20, 30], [20, FLOOR]], { stroke: EQ, width: EQ_W });
    s.line([[52, 30], [52, FLOOR]], { stroke: EQ, width: EQ_W });
    s.line([[14, 30], [26, 30]], { stroke: EQ, width: EQ_W });
    s.line([[46, 30], [58, 30]], { stroke: EQ, width: EQ_W });
    s.floor();
    const p = frontPose({
      hip: [36, 41], sh: [36, 27],
      armL: [[25, 31], [20, 29]], armR: [[47, 31], [52, 29]],
      legL: [[31, 50], [35, 58]], legR: [[41, 50], [37, 58]],
    });
    frontPerson(s, p);
  },

  // ------------------------------------------------------------ shoulders ---
  'overhead-press'(s) {
    s.floor();
    const p = frontPose({
      hip: [36, 40], sh: [36, 26],
      armL: [[26, 22], [25, 14]], armR: [[46, 22], [47, 14]],
      legL: [[32, 51], [32, GROUND]], legR: [[40, 51], [40, GROUND]],
    });
    frontPerson(s, p);
    s.barbell(13, 12, 60, { ph: 11 });
  },

  'dumbbell-shoulder-press'(s) {
    s.floor();
    s.pad([[26, 46], [46, 46]]);
    s.pad([[27, 44], [27, 22]]);
    s.line([[40, 48], [40, FLOOR]], { stroke: EQ, width: EQ_W });
    const p = sidePose({
      hip: [33, 44], torso: -88,
      arm: [[36, 26], [34, 18]], armFar: [[38.5, 27], [36.5, 19]],
      leg: [5, 92], legFar: [-2, 100],
    });
    s.person(p);
    s.dumbbell([34, 15]);
  },

  'lateral-raise'(s) {
    s.floor();
    const p = frontPose({
      hip: [36, 40], sh: [36, 26],
      armL: [[25, 28], [16, 27]], armR: [[47, 28], [56, 27]],
      legL: [[32, 51], [32, GROUND]], legR: [[40, 51], [40, GROUND]],
    });
    frontPerson(s, p);
    s.dumbbell([14, 27], { vertical: true, half: 3.6, head: 5.6, thick: 3 });
    s.dumbbell([58, 27], { vertical: true, half: 3.6, head: 5.6, thick: 3 });
  },

  'cable-lateral-raise'(s) {
    s.column(62, { pulley: 56 });
    s.floor(7, 58);
    s.cable([[62, 56], [30, 50], [18, 28]]);
    const p = frontPose({
      hip: [34, 40], sh: [34, 26],
      armL: [[24, 28], [16, 27]], armR: [[43, 30], [44, 40]],
      legL: [[30, 51], [30, GROUND]], legR: [[38, 51], [38, GROUND]],
    });
    frontPerson(s, p);
    s.handle([16.5, 27], { vertical: false, len: 7 });
  },

  'reverse-butterfly'(s) {
    // Rear-delt machine from behind: straight arms sweeping out on lever arms.
    s.line([[36, 10], [36, 30]], { stroke: EQ, width: EQ_W });
    s.line([[36, 12], [18, 26]], { stroke: EQ, width: EQ_W });
    s.line([[36, 12], [54, 26]], { stroke: EQ, width: EQ_W });
    s.pad([[27, 50], [45, 50]]);
    s.line([[36, 52], [36, FLOOR]], { stroke: EQ, width: EQ_W });
    const p = frontPose({
      hip: [36, 47], sh: [36, 33],
      armL: [[27, 30], [17, 27]], armR: [[45, 30], [55, 27]],
      legL: [[29, 52], [29, GROUND]], legR: [[43, 52], [43, GROUND]],
    });
    frontPerson(s, p);
    s.handle([17, 27]);
    s.handle([55, 27]);
  },

  'face-pull'(s) {
    s.column(62, { pulley: 20 });
    s.floor(7, 58);
    s.cable([[62, 20], [46, 20]]);
    const p = sidePose({
      hip: [28, 40], torso: -92,
      arm: [[22, 24], [38, 19]], armFar: [[23, 27], [38, 22]],
      leg: [78, 96], legFar: [70, 104],
    });
    s.person(p);
    s.line([[46, 20], [40, 17.5]], { stroke: ACC, width: 2.6 });
    s.line([[46, 20], [40, 22.5]], { stroke: ACC, width: 2.6 });
  },

  // ----------------------------------------------------------------- back ---
  'pull-up'(s) {
    s.line([[9, 10], [63, 10]], { stroke: EQ, width: 3 });
    const p = frontPose({
      hip: [36, 40], sh: [36, 26],
      armL: [[24, 25], [18, 12]], armR: [[48, 25], [54, 12]],
      legL: [[31, 50], [33, 60]], legR: [[41, 50], [39, 60]],
    });
    frontPerson(s, p);
  },

  'lat-pulldown'(s) {
    s.circle([36, 9], 2.4, { stroke: EQ, width: 2 });
    s.cable([[36, 11.5], [36, 18]]);
    s.line([[15, 22], [20, 18], [52, 18], [57, 22]], { stroke: ACC, width: 3 });
    const p = frontPose({
      hip: [36, 46], sh: [36, 32],
      armL: [[25, 30], [20, 19]], armR: [[47, 30], [52, 19]],
      legL: [[30, 50], [30, GROUND]], legR: [[42, 50], [42, GROUND]],
    });
    frontPerson(s, p);
    s.pad([[27, 45], [45, 45]]);
    s.pad([[32, 53], [40, 53]]);
  },

  'seated-cable-row'(s) {
    s.column(61, { pulley: 48 });
    s.pad([[10, 54], [32, 54]]);
    s.line([[52, 45], [52, 57]], { stroke: EQ, width: EQ_W });
    const p = sidePose({
      hip: [22, 50], torso: -95,
      arm: [[16, 44], [28, 45]], armFar: [[17, 47], [28, 47.5]],
      leg: [[36, 48], [49, 52]], legFar: [[36, 50.5], [48, 54]],
    });
    s.person(p);
    s.cable([[30, 45.5], [61, 48]]);
    s.handle([30, 45.5]);
  },

  'barbell-row'(s) {
    s.floor();
    const p = sidePose({
      hip: [27, 36], torso: -18,
      arm: [[32, 40], [32, 48]], armFar: [[34, 41], [34, 49]],
      leg: [82, 100], legFar: [74, 108],
    });
    s.person(p);
    s.plate([32, 50.5], 5.8);
  },

  'dumbbell-row'(s) {
    s.floor();
    s.bench(18, 56, 47);
    const p = sidePose({
      hip: [28, 35], torso: -12,
      arm: [[36, 31], [37, 39]], armFar: [[45, 38], [48, 45]],
      leg: [[18, 47], [14, GROUND]], legFar: [[32, 45], [40, 45]],
    });
    s.person(p);
    s.dumbbell([37, 41.5], { half: 3.6, head: 5.6, thick: 3 });
  },

  'single-arm-cable-row'(s) {
    s.column(62, { pulley: 38 });
    s.floor(7, 58);
    const p = sidePose({
      hip: [26, 38], torso: -84,
      arm: [[22, 33], [34, 38]], armFar: [[30, 32], [40, 38]],
      leg: [[38, 46], [44, GROUND]], legFar: [[18, 48], [12, GROUND]],
    });
    s.person(p);
    s.cable([[36, 38], [62, 38]]);
    s.handle([36, 38]);
  },

  'dumbbell-pullover'(s) {
    s.floor();
    s.bench(20, 56, 43);
    const p = sidePose({
      hip: [44, 39.5], torso: 180,
      arm: [[24, 34], [17, 28]], armFar: [[25, 36], [18, 30]],
      leg: [42, 96], legFar: [34, 104],
    });
    s.person(p);
    s.dumbbell([14, 26], { vertical: true, half: 3.6, head: 5.6, thick: 3 });
  },

  'back-extension'(s) {
    s.floor();
    // A 45-degree bench: hip pad at the top, ankle rollers at the foot.
    s.line([[19, 59], [43, 35]], { stroke: EQ, width: EQ_W });
    s.line([[24, 54], [24, FLOOR]], { stroke: EQ, width: EQ_W });
    s.pad([[33, 45], [41, 37]]);
    s.circle([18, 53], 3.2, { fill: PAD, stroke: EQ, width: 2 });
    s.circle([22, 57], 3.2, { fill: PAD, stroke: EQ, width: 2 });
    const p = sidePose({
      hip: [38, 40], torso: -45,
      arm: [[44, 34], [50, 33]], armFar: [[45, 36], [51, 35]],
      leg: [[28, 49], [20, 55]], legFar: [[27, 51], [19, 57]],
    });
    s.person(p);
  },

  superman(s) {
    s.floor(9, 63, 62);
    // Chest and hips stay down; arms and legs lift clear of the floor.
    const p = sidePose({
      hip: [36, 58], torso: -13, neck: -45,
      arm: [[57, 53], [63, 47]], armFar: [[56, 55], [62, 49]],
      leg: [[24, 55], [12, 47]], legFar: [[24, 57], [12, 49]],
    });
    s.person(p);
  },

  'good-morning'(s) {
    s.floor();
    const p = sidePose({
      hip: [30, 36], torso: -22,
      arm: [[38, 30], [42, 36]], armFar: [[40, 31], [44, 37]],
      leg: [86, 92], legFar: [80, 98],
    });
    s.person(p);
    s.plate([44.5, 32], 5.8);
  },

  // ------------------------------------------------------------ legs, hips ---
  squat(s) {
    s.floor();
    s.plate([24, 30.5], 6);
    const p = sidePose({
      hip: [26, 46], torso: -68,
      arm: [[26, 38], [23, 31]], armFar: [[27, 40], [24, 33]],
      leg: [[39, 46], [36, GROUND]], legFar: [[37, 48.5], [34, GROUND]],
    });
    s.person(p);
  },

  'bulgarian-split-squat'(s) {
    s.floor();
    s.bench(7, 25, 46, { legs: false });
    s.line([[13, 48], [13, FLOOR]], { stroke: EQ, width: EQ_W });
    const p = sidePose({
      hip: [33, 42], torso: -86,
      arm: [90, 92], armFar: [84, 98],
      leg: [[45, 47], [45, GROUND]], legFar: [[24, 52], [17, 46]],
    });
    s.person(p);
  },

  lunge(s) {
    s.floor();
    // Front knee over the foot, rear knee down towards the floor.
    const p = sidePose({
      hip: [32, 40], torso: -88,
      arm: [96, 92], armFar: [88, 84],
      leg: [[44, 46], [44, GROUND]], legFar: [[22, 54], [15, 60]],
    });
    s.person(p);
  },

  'leg-press'(s) {
    // Seated sled: the back rest is low, the platform stands in front.
    s.floor();
    s.pad([[14, 48], [32, 48]]);
    s.pad([[13, 46], [10, 30]]);
    s.line([[10, 50], [56, 50]], { stroke: EQ, width: EQ_W });
    s.rect(50, 24, 5.5, 26, { rx: 2 });
    const p = sidePose({
      hip: [20, 44], torso: -100,
      arm: [[16, 44], [14, 49]], armFar: [[17, 46], [15, 51]],
      leg: [[34, 39], [48, 37]], legFar: [[34, 43], [48, 42]],
    });
    s.person(p);
  },

  'leg-press-45-plate-loaded'(s) {
    s.floor();
    // Rails climbing at 45 degrees, with a plate-loaded sled on them.
    s.line([[14, 60], [56, 18]], { stroke: EQ, width: EQ_W });
    s.line([[20, 62], [58, 24]], { stroke: EQ, width: EQ_W });
    s.line([[41, 22], [53, 34]], { stroke: EQ, width: 3 });
    s.circle([44, 32], 5.4, { fill: ACC });
    s.circle([44, 32], 1.4, { fill: PAD });
    s.pad([[12, 58], [24, 52]]);
    const p = sidePose({
      hip: [26, 50], torso: -166,
      arm: [[22, 46], [16, 48]], armFar: [[23, 48], [17, 50]],
      leg: [[36, 40], [44, 33]], legFar: [[37, 43], [45, 36]],
    });
    s.person(p);
  },

  'leg-extension'(s) {
    s.floor();
    s.pad([[16, 44], [16, 26]]);
    s.pad([[16, 46], [32, 46]]);
    s.line([[22, 48], [22, FLOOR]], { stroke: EQ, width: EQ_W });
    s.line([[34, 46], [34, 56]], { stroke: EQ, width: EQ_W });
    const p = sidePose({
      hip: [22, 42], torso: -92,
      arm: [[18, 38], [22, 44]], armFar: [[19, 40], [23, 46]],
      leg: [[35, 44], [48, 42]], legFar: [[35, 46.5], [48, 45]],
    });
    s.person(p);
    s.circle([50, 41], 3.4, { fill: ACC });
  },

  'leg-curl'(s) {
    s.floor();
    s.bench(12, 46, 45);
    const p = sidePose({
      hip: [38, 41.5], torso: 176,
      arm: [[26, 38], [17, 39]], armFar: [[27, 40], [18, 41]],
      leg: [[50, 43], [52, 30]], legFar: [[50, 45.5], [54, 33]],
    });
    s.person(p);
    s.circle([53, 27], 3.4, { fill: ACC });
  },

  'calf-raise'(s) {
    s.floor();
    // Standing on a step with the heels hanging off it.
    s.rect(30, 54, 26, 8, { rx: 2, fill: PAD, stroke: EQ, width: 2.2 });
    const p = sidePose({
      hip: [34, 32], torso: -90,
      arm: [88, 88], armFar: [82, 82],
      leg: [[34.5, 41], [34, 49]], legFar: [[32.5, 41], [32, 49]],
    });
    s.person(p);
    // Only the ball of the foot is on the step; the heel stays clear above it.
    s.line([[34, 49.5], [44, 54]], { stroke: INK, width: 4 });
  },

  deadlift(s) {
    s.floor();
    const p = sidePose({
      hip: [26, 40], torso: -38,
      arm: [[36, 39], [37, 48]], armFar: [[38, 40], [39, 49]],
      leg: [[34, 50], [30, GROUND]], legFar: [[32, 52], [28, GROUND]],
    });
    s.person(p);
    s.plate([37.5, 53], 7);
  },

  'romanian-deadlift'(s) {
    s.floor();
    const p = sidePose({
      hip: [28, 36], torso: -26,
      arm: [[38, 36], [39, 45]], armFar: [[40, 37], [41, 46]],
      leg: [84, 92], legFar: [78, 98],
    });
    s.person(p);
    s.plate([39.5, 47], 5.8);
  },

  'hip-thrust'(s) {
    s.floor();
    s.bench(8, 30, 44, { legs: false });
    s.line([[14, 46], [14, FLOOR]], { stroke: EQ, width: EQ_W });
    const p = sidePose({
      hip: [36, 40], torso: 178,
      arm: [[20, 38], [14, 42]], armFar: [[21, 40], [15, 44]],
      leg: [[48, 41], [48, GROUND]], legFar: [[46, 43], [46, GROUND]],
    });
    s.person(p);
    s.plate([36, 36], 6);
  },

  'glute-bridge'(s) {
    s.floor(7, 65, 62);
    const p = sidePose({
      hip: [34, 42], torso: 160,
      arm: [[22, 50], [14, 58]], armFar: [[23, 52], [15, 60]],
      leg: [[46, 45], [46, 59]], legFar: [[44, 47], [44, 59]],
    });
    s.person(p);
  },

  // ----------------------------------------------------------------- core ---
  plank(s) {
    s.floor(7, 65, 62);
    // Forearms on the floor, elbows under the shoulders.
    const p = sidePose({
      hip: [32.7, 52.3], torso: -18,
      arm: [[46, 58], [54, 58.5]], armFar: [[44.5, 59], [52, 59.5]],
      leg: [[20, 56], [8, 59.5]], legFar: [[20, 58], [8, 61]],
    });
    s.person(p);
  },

  crunch(s) {
    s.floor(7, 65, 62);
    // Knees bent, hands at the head, shoulders just off the floor.
    const p = sidePose({
      hip: [30, 55], torso: -30,
      arm: [[44, 40], [48, 43]], armFar: [[43, 42], [47, 45]],
      leg: [[20, 46], [14, 58]], legFar: [[19, 48], [13, 59.5]],
    });
    s.person(p);
  },

  'sit-up'(s) {
    s.floor(7, 65, 62);
    // The whole torso comes up; the hands reach past the knees.
    const p = sidePose({
      hip: [30, 56], torso: -62,
      arm: [[30, 48], [22, 48]], armFar: [[31, 50], [23, 50]],
      leg: [[20, 47], [14, 58.5]], legFar: [[19, 49], [13, 60]],
    });
    s.person(p);
  },

  'leg-raise'(s) {
    s.floor(7, 65, 62);
    const p = sidePose({
      hip: [42, 57], torso: 178,
      arm: [[36, 52], [30, 53]], armFar: [[36, 54], [30, 55]],
      leg: [[50, 46], [54, 34]], legFar: [[49, 48], [53, 36]],
    });
    s.person(p);
  },

  'russian-twist'(s) {
    s.floor(7, 65, 62);
    // A V-sit: the feet stay off the floor and the weight goes to one side.
    const p = sidePose({
      hip: [28, 56], torso: -70,
      arm: [[38, 41], [44, 44]], armFar: [[37, 43], [43, 46]],
      leg: [[19, 44], [11, 47]], legFar: [[18, 46], [10, 49]],
    });
    s.person(p);
    s.circle([47, 45], 4.6, { fill: ACC });
  },

  // ----------------------------------------------------------------- arms ---
  'biceps-curl'(s) {
    s.floor();
    const p = frontPose({
      hip: [36, 40], sh: [36, 26],
      armL: [[26, 34], [28, 25]], armR: [[46, 34], [46, 43]],
      legL: [[32, 51], [32, GROUND]], legR: [[40, 51], [40, GROUND]],
    });
    frontPerson(s, p);
    s.dumbbell([27, 23.5], { half: 4.2, head: 6, thick: 3 });
    s.dumbbell([46.5, 45.5], { half: 4.2, head: 6, thick: 3 });
  },

  'hammer-curl'(s) {
    s.floor();
    const p = frontPose({
      hip: [36, 40], sh: [36, 26],
      armL: [[26, 34], [28, 25]], armR: [[46, 34], [44, 25]],
      legL: [[32, 51], [32, GROUND]], legR: [[40, 51], [40, GROUND]],
    });
    frontPerson(s, p);
    s.dumbbell([27, 22], { vertical: true, half: 4.2, head: 6, thick: 3 });
    s.dumbbell([45, 22], { vertical: true, half: 4.2, head: 6, thick: 3 });
  },

  'triceps-pushdown'(s) {
    s.circle([36, 9], 2.4, { stroke: EQ, width: 2 });
    s.cable([[36, 11.5], [36, 34]]);
    s.floor();
    const p = frontPose({
      hip: [36, 42], sh: [36, 28],
      armL: [[29, 34], [31, 40]], armR: [[43, 34], [41, 40]],
      legL: [[32, 52], [32, GROUND]], legR: [[40, 52], [40, GROUND]],
    });
    frontPerson(s, p);
    s.line([[27, 40], [45, 40]], { stroke: ACC, width: 3.4 });
  },

  'triceps-rope-pushdown'(s) {
    s.circle([36, 9], 2.4, { stroke: EQ, width: 2 });
    s.cable([[36, 11.5], [36, 30]]);
    s.floor();
    const p = frontPose({
      hip: [36, 42], sh: [36, 28],
      armL: [[29, 34], [28, 41]], armR: [[43, 34], [44, 41]],
      legL: [[32, 52], [32, GROUND]], legR: [[40, 52], [40, GROUND]],
    });
    frontPerson(s, p);
    s.line([[36, 30], [27, 43]], { stroke: ACC, width: 3 });
    s.line([[36, 30], [45, 43]], { stroke: ACC, width: 3 });
  },

  // ------------------------------------------------- cardio, conditioning ---
  running(s) {
    s.floor();
    const p = sidePose({
      hip: [34, 38], torso: -80,
      arm: [[28, 32], [22, 26]], armFar: [[42, 34], [48, 30]],
      leg: [[46, 44], [46, GROUND]], legFar: [[24, 44], [16, 52]],
    });
    s.person(p);
  },

  'trail-running'(s) {
    s.line([[7, 62], [30, 56], [46, 44], [65, 38]], { stroke: EQ, width: EQ_W });
    s.circle([22, 55], 2, { fill: EQ });
    const p = sidePose({
      hip: [34, 34], torso: -74,
      arm: [[28, 28], [22, 22]], armFar: [[42, 30], [48, 26]],
      leg: [[44, 40], [46, 50]], legFar: [[26, 40], [20, 47]],
    });
    s.person(p);
  },

  cycling(s) {
    s.floor();
    s.circle([17, 51], 10, { stroke: EQ, width: EQ_W });
    s.circle([55, 51], 10, { stroke: EQ, width: EQ_W });
    s.line([[17, 51], [36, 51], [30, 34], [46, 34], [55, 51]], { stroke: EQ, width: EQ_W });
    s.line([[36, 51], [30, 34]], { stroke: EQ, width: EQ_W });
    s.circle([36, 51], 2.6, { fill: ACC });
    const p = sidePose({
      hip: [31, 32], torso: -46,
      arm: [[44, 28], [48, 32]], armFar: [[43, 30], [47, 34]],
      leg: [[38, 44], [36, 53]], legFar: [[36, 42], [34, 49]],
    });
    s.person(p);
  },

  swimming(s) {
    const p = sidePose({
      hip: [30, 44], torso: -6,
      arm: [[52, 35], [60, 30]], armFar: [[36, 47], [27, 49]],
      leg: [[18, 46], [8, 48]], legFar: [[18, 48], [8, 51]],
    });
    s.person(p);
    s.curve([7, 57], [21, 52], [35, 57], { stroke: EQ, width: EQ_W });
    s.curve([35, 57], [49, 62], [64, 56], { stroke: EQ, width: EQ_W });
  },

  'jump-rope'(s) {
    s.floor();
    s.curve([22, 30], [36, 8], [50, 30], { stroke: ACC, width: 2.6 });
    s.curve([22, 30], [36, 58], [50, 30], { stroke: ACC, width: 2.6 });
    const p = frontPose({
      hip: [36, 38], sh: [36, 24],
      armL: [[27, 28], [23, 30]], armR: [[45, 28], [49, 30]],
      legL: [[33, 47], [34, 56]], legR: [[39, 47], [38, 56]],
    });
    frontPerson(s, p);
  },

  burpee(s) {
    s.floor();
    s.line([[20, 57], [14, 57]], { stroke: EQ, width: 2.2 });
    s.line([[52, 57], [58, 57]], { stroke: EQ, width: 2.2 });
    const p = frontPose({
      hip: [36, 36], sh: [36, 22],
      armL: [[27, 17], [24, 9]], armR: [[45, 17], [48, 9]],
      legL: [[31, 46], [34, 54]], legR: [[41, 46], [38, 54]],
    });
    frontPerson(s, p);
  },

  'farmers-walk'(s) {
    s.floor();
    const p = sidePose({
      hip: [34, 36], torso: -88,
      arm: [[31, 31], [30, 40]], armFar: [[38, 31], [39, 40]],
      leg: [[44, 48], [46, GROUND]], legFar: [[26, 48], [22, GROUND]],
    });
    s.person(p);
    s.dumbbell([30, 43], { half: 4.2, head: 6, thick: 3 });
    s.dumbbell([39, 43.5], { half: 4.2, head: 6, thick: 3 });
  },
};

mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) {
  if (file.endsWith('.svg') && !(file.slice(0, -4) in scenes)) rmSync(join(OUT, file));
}
for (const [name, draw] of Object.entries(scenes)) {
  const scene = new Scene();
  draw(scene);
  writeFileSync(join(OUT, `${name}.svg`), scene.render(), 'utf8');
}
console.log(`${Object.keys(scenes).length} thumbnails written to ${OUT}`);

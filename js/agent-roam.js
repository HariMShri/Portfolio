import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import {
  AGENTS, APPLICANT, box, cylinder, sphere, torus, plane, material, mesh,
  createPerson, POSE, approach, applyPose, walkPose,
} from './agent-rig.js';

/* Site-wide agent layer: the seven engineers from the office scene leave it
   and work across the whole page. They stand on the top edges of real page
   elements, walk along them, leap between nearby ones and portal to far ones,
   and act out a different task in each place -- scouting from the hero stats,
   measuring skill cards, reviewing certifications, delivering drafts to the
   contact form, squashing bugs that crawl onto the page.

   The canvas never takes pointer events, so the page underneath works as
   normal. Only the speech bubbles are clickable; they open that engineer in
   the office scene. Off by default under prefers-reduced-motion, and the
   floating toggle remembers each visitor's choice. */

const STORAGE_KEY = 'agentRoam';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const toggle = document.getElementById('agentRoamToggle');

function readPreference() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'on' || stored === 'off') return stored === 'on';
  } catch { /* storage blocked: fall through to the default */ }
  return !reducedMotion.matches;
}

function writePreference(on) {
  try { window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

const layer = document.createElement('div');
layer.className = 'agent-roam';
layer.setAttribute('aria-hidden', 'true');
const canvas = document.createElement('canvas');
canvas.className = 'agent-roam__canvas';
layer.append(canvas);
document.body.append(layer);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
} catch (error) {
  layer.remove();
  if (toggle) toggle.hidden = true;
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
// Pixel-space orthographic camera: world x = screen x, world y = -screen y.
const camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 2000);
camera.position.z = 1000;
scene.add(new THREE.HemisphereLight(0xeef3f8, 0x5a4a3c, 2.3));
const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.4);
keyLight.position.set(-0.45, 0.8, 1);
scene.add(keyLight);

/* ---------- tasks ---------- */

// Each task names an animation, the page elements it can happen on, and what
// the engineer says while doing it. Lines can be functions of live counts.
const TASKS = {
  scout: {
    anim: 'binoculars', spots: ['.hero__stat', '.section__eyebrow', '.agent-world__heading'],
    lines: [(c) => (c ? `Scanned ${c.discovered.toLocaleString()} listings today` : 'Scouting fresh QA roles'), 'Spotted a Test Lead opening', 'Watching the job boards'],
  },
  shortlist: {
    anim: 'clipboard', spots: ['.ai-work__card', '.timeline__item', '.agent-world__heading'],
    lines: [(c) => (c ? `${c.shortlisted} roles on the shortlist` : 'Shortlisting roles that fit'), 'Filtering out senior-only listings'],
  },
  score: {
    anim: 'measure', spots: ['.skill-card'],
    lines: ['Scoring skill fit against the JD', 'Measuring ATS keyword match', 'This skill is in demand'],
  },
  match: {
    anim: 'clipboard', spots: ['.timeline__content', '.skill-card', '.about__card'],
    lines: ['Matching experience to the job spec', 'Mapping this role to the JD'],
  },
  tailor: {
    anim: 'measure', spots: ['.timeline__content', '.contact__resume', '.about__card'],
    lines: ['Tailoring this bullet for ATS', 'Trimming the resume to one page', 'Fitting keywords, no new claims'],
  },
  stitch: {
    anim: 'polish', spots: ['.about__card', '.edu-card', '.timeline__content'],
    lines: ['Stitching verified facts into a draft', 'Pressing the formatting flat'],
  },
  write: {
    anim: 'laptop', sit: true, spots: ['.about__card', '.contact__form', '.ai-work__card'],
    lines: [(c) => (c ? `${c.drafted} cover notes drafted` : 'Drafting a cover note'), 'Writing a reply template', 'Rewording a summary line'],
  },
  review: {
    anim: 'magnify', spots: ['.ai-work__card', '.edu-card', '.timeline__content', '.skill-card'],
    lines: ['Checking for unverified claims', 'Verifying this certification', 'Proofreading every bullet'],
  },
  deliver: {
    anim: 'carry', carry: true, spots: ['.contact__form', '.contact__item', '.agent-world__heading'],
    lines: [(c) => (c ? `${c.awaiting_review} drafts queued for review` : 'Packing the application bundle'), 'Queuing drafts for human review'],
  },
  track: {
    anim: 'tablet', spots: ['.hero__stat', '.skills__grid', '.agent-world__heading', '.edu-card'],
    lines: ['Tracking response rates', 'Logging ATS keyword trends', "Charting this week's matches"],
  },
  regress: {
    anim: 'laptop', sit: true, spots: ['.skill-card', '.timeline__content', '.ai-work__card'],
    lines: ['Running the regression suite', 'Writing a Postman API test', 'Validating SQL results'],
  },
  a11y: {
    anim: 'magnify', spots: ['.section__eyebrow', '.hero__stat', '.contact__item'],
    lines: ['Auditing colour contrast', 'Checking keyboard focus order', 'Testing on a small screen'],
  },
  deploy: {
    anim: 'carry', carry: true, spots: ['.ai-work__card', '.agent-world__heading', '.edu-card'],
    lines: ['Shipping a release build', 'Moving tested builds to staging'],
  },
  apply: {
    anim: 'laptop', sit: true, spots: ['.contact__form', '.ai-work__card', '.timeline__content'],
    lines: ['Filling a Greenhouse form, you approve first', 'Attaching your tailored resume', 'Left the custom questions for you'],
  },
  answers: {
    anim: 'clipboard', spots: ['.contact__item', '.about__card', '.edu-card'],
    lines: ['Only answering questions you answered', 'No logins, ever: that part is yours'],
  },
  // Shared tasks any engineer picks up between their own.
  coffee: {
    anim: 'coffee', sit: true, spots: ['.section__eyebrow', '.edu-card', '.hero__stat', '.contact__item', '.skill-card'],
    lines: ['Coffee break', 'Recharging between runs', 'Waiting for the next cron'],
  },
  wave: {
    anim: 'wave', spots: ['.hero__stat', '.section__eyebrow', '.contact__item', '.about__card'],
    lines: [(c, agent) => `Hi! I'm ${agent.first}, ${agent.role}`, (c, agent) => `${agent.first} here, say hello below`],
  },
  polish: {
    anim: 'polish', spots: ['.section__eyebrow', '.hero__stat'],
    lines: ['Polishing the headline', 'Dusting off the stats'],
  },
  // Driven by events rather than picked at random.
  handoff: { anim: 'handoff', lines: [] },
  squash: { anim: 'stomp', lines: ['Bug squashed: regression passed', 'Found one! Fixed and retested', 'Defect closed'] },
  live: { anim: 'laptop', sit: true, spots: ['#agentNetwork'], lines: [(c, agent) => `Live run: ${agent.role.toLowerCase()} at work`] },
  cheer: { anim: 'cheer', lines: ['Message sent!', 'Thanks for reaching out!'] },
};

const ROSTER = {
  'role-scout': ['scout', 'scout', 'shortlist', 'a11y'],
  'fit-analyst': ['score', 'score', 'match', 'regress'],
  'resume-tailor': ['tailor', 'tailor', 'stitch', 'score'],
  'application-writer': ['write', 'write', 'regress', 'stitch'],
  'application-reviewer': ['review', 'review', 'a11y', 'regress'],
  'application-coordinator': ['deliver', 'deploy', 'shortlist'],
  'feedback-analyst': ['track', 'track', 'match', 'a11y'],
  applicant: ['apply', 'apply', 'answers', 'deliver'],
};
const SHARED = ['coffee', 'wave', 'polish'];

const HANDOFF_LINES = {
  'role-scout': (to) => `New roles for you, ${to}`,
  'fit-analyst': (to) => `Fit scores ready, ${to}`,
  'resume-tailor': (to) => `Tailored resume for you, ${to}`,
  'application-writer': (to) => `Draft ready for review, ${to}`,
  'application-reviewer': (to) => `Approved, over to you, ${to}`,
  'application-coordinator': (to) => `Your next batch, ${to}`,
  'feedback-analyst': (to) => `This week's trends, ${to}`,
  applicant: (to) => `Application filed, ${to}`,
};

/* ---------- props ---------- */

function buildProps(rig, agent) {
  const dark = material(0x24292e, { roughness: 0.5, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: agent.accent, emissive: agent.accent, emissiveIntensity: 0.55, roughness: 0.4 });
  const paper = material(0xf2efe4, { roughness: 0.8 });
  const hand = rig.arms.right.hand;
  const leftHand = rig.arms.left.hand;
  const props = {};

  props.binoculars = new THREE.Group();
  for (const side of [-1, 1]) {
    mesh(cylinder(0.034, 0.04, 0.12, 10), dark, props.binoculars, [side * 0.042, 0, 0], { rotation: [Math.PI / 2, 0, 0], cast: false });
  }
  props.binoculars.position.set(0, 0.055, 0.19);
  rig.head.add(props.binoculars);

  props.magnifier = new THREE.Group();
  mesh(torus(0.075, 0.012, 6, 20), dark, props.magnifier, [0, -0.2, 0.02], { cast: false });
  mesh(new THREE.CircleGeometry(0.068, 20), new THREE.MeshStandardMaterial({
    color: 0xcfe8f2, roughness: 0.05, transparent: true, opacity: 0.45,
  }), props.magnifier, [0, -0.2, 0.02], { cast: false });
  mesh(cylinder(0.016, 0.016, 0.12, 8), material(0x6b4a33, { roughness: 0.7 }), props.magnifier, [0, -0.08, 0.02], { cast: false });
  hand.add(props.magnifier);

  props.tape = mesh(box(0.66, 0.035, 0.01), material(0xe2b941, { roughness: 0.5 }), rig.torso, [0, 0.36, 0.5], { cast: false });

  props.clipboard = new THREE.Group();
  mesh(box(0.2, 0.27, 0.014), material(0x8a6844, { roughness: 0.8 }), props.clipboard, [0, 0, 0], { cast: false });
  mesh(box(0.17, 0.22, 0.004), paper, props.clipboard, [0, -0.01, 0.009], { cast: false });
  props.clipboard.position.set(0.02, -0.12, 0.07);
  props.clipboard.rotation.set(-0.9, 0, 0.2);
  leftHand.add(props.clipboard);

  props.tablet = new THREE.Group();
  mesh(box(0.24, 0.17, 0.014), dark, props.tablet, [0, 0, 0], { cast: false });
  mesh(plane(0.21, 0.14), accent, props.tablet, [0, 0, 0.008], { cast: false });
  props.tablet.position.set(0.03, -0.12, 0.07);
  props.tablet.rotation.set(-0.9, 0, 0.2);
  leftHand.add(props.tablet);

  props.laptop = new THREE.Group();
  mesh(box(0.36, 0.02, 0.25), material(0x9aa3ab, { roughness: 0.4, metalness: 0.5 }), props.laptop, [0, 0, 0], { cast: false });
  const lid = new THREE.Group();
  lid.position.set(0, 0.01, -0.12);
  lid.rotation.x = -0.32;
  props.laptop.add(lid);
  mesh(box(0.36, 0.24, 0.014), material(0x9aa3ab, { roughness: 0.4, metalness: 0.5 }), lid, [0, 0.12, 0], { cast: false });
  mesh(plane(0.32, 0.2), accent, lid, [0, 0.12, 0.009], { cast: false });
  props.laptop.position.set(0, 0.1, 0.36);
  rig.hips.add(props.laptop);

  props.parcel = new THREE.Group();
  mesh(box(0.36, 0.26, 0.28), material(0xb48a5a, { roughness: 0.9 }), props.parcel, [0, 0, 0], { cast: false });
  mesh(box(0.37, 0.05, 0.285), material(0xd8c39a, { roughness: 0.8 }), props.parcel, [0, 0.03, 0], { cast: false });
  props.parcel.position.set(0, 0.16, 0.34);
  rig.torso.add(props.parcel);

  props.paper = mesh(plane(0.17, 0.22), new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 0.8, side: THREE.DoubleSide }),
    hand, [0, -0.15, 0.06], { rotation: [-0.3, 0, 0], cast: false });

  props.cloth = mesh(box(0.11, 0.05, 0.09), accent, hand, [0, -0.07, 0.03], { cast: false });

  props.mug = rig.arms.right.mug;

  for (const prop of Object.values(props)) prop.visible = false;
  return props;
}

const PROP_FOR = {
  binoculars: 'binoculars', magnify: 'magnifier', measure: 'tape', clipboard: 'clipboard',
  tablet: 'tablet', laptop: 'laptop', carry: 'parcel', handoff: 'paper', polish: 'cloth', coffee: 'mug',
};

/* ---------- poses ---------- */

// Sitting on a ledge: hips rest on the edge and the legs hang over it.
const LEDGE_SIT = { ...POSE.sitWork, hipsY: 0.57, torso: 0.02, thigh: -1.42, knee: 1.42, foot: 0.12 };

function taskPose(anim, t, i) {
  const s = POSE.stand;
  switch (anim) {
    case 'binoculars':
      return { ...s, torso: -0.05, head: -0.04, headTurn: Math.sin(t * 0.45 + i) * 0.55, shoulder: -1.15, elbow: -1.95, spreadL: 0.2, spreadR: 0.2 };
    case 'magnify':
      return {
        ...s, hipsY: 0.89, torso: 0.3, head: 0.32, headTurn: Math.sin(t * 0.7 + i) * 0.3,
        shoulderR: -1.05 + Math.sin(t * 1.3 + i) * 0.14, elbowR: -0.55, shoulderL: -0.15, elbowL: -0.8,
      };
    case 'measure':
      return {
        ...s, torso: 0.06, head: 0.2, shoulder: -1.3, elbow: -0.35,
        spreadL: 0.42 + Math.sin(t * 1.1 + i) * 0.08, spreadR: 0.42 + Math.sin(t * 1.1 + i) * 0.08,
      };
    case 'clipboard':
    case 'tablet':
      return {
        ...s, head: 0.32, headTurn: Math.sin(t * 0.5 + i) * 0.15,
        shoulderL: -0.75, elbowL: -1.35,
        shoulderR: -0.62 + Math.sin(t * 7 + i) * 0.04, elbowR: -1.5 + Math.cos(t * 7 + i) * 0.06,
      };
    case 'laptop': {
      const typing = Math.sin(t * 10 + i * 1.7) * 0.06;
      return {
        ...LEDGE_SIT, head: 0.28, shoulder: -0.62, elbowL: -1.0 + typing, elbowR: -1.0 - typing,
        knee: LEDGE_SIT.knee + Math.sin(t * 1.4 + i) * 0.08,
      };
    }
    case 'coffee': {
      const sip = Math.max(0, Math.sin(t * 0.8 + i)) ** 3;
      return {
        ...LEDGE_SIT, torso: -0.08, headTurn: Math.sin(t * 0.4 + i) * 0.35, head: -0.04 - sip * 0.12,
        shoulderR: -0.45 - sip * 0.75, elbowR: -1.45 - sip * 0.5, shoulderL: -0.1, elbowL: -0.3,
        kneeL: LEDGE_SIT.knee + Math.sin(t * 2.1 + i) * 0.18, kneeR: LEDGE_SIT.knee - Math.sin(t * 2.1 + i) * 0.18,
      };
    }
    case 'wave':
      return { ...s, head: -0.05, spreadR: 2.55, shoulderR: -0.15, elbowR: -0.35 + Math.sin(t * 9) * 0.45, shoulderL: -0.05, elbowL: -0.2 };
    case 'polish':
      return {
        ...s, hipsY: 0.88, torso: 0.36, head: 0.3,
        shoulderR: -1.0 + Math.sin(t * 6 + i) * 0.28, elbowR: -0.6, spreadR: 0.18 + Math.cos(t * 6 + i) * 0.16,
        shoulderL: -0.3, elbowL: -0.6,
      };
    case 'carry':
      return { ...s, head: 0.1, shoulder: -0.95, elbow: -0.95, spreadL: 0.1, spreadR: 0.1 };
    case 'handoff':
      return { ...s, torso: 0.08, head: 0.05, shoulderR: -1.42, elbowR: -0.18, shoulderL: -0.08, elbowL: -0.25 };
    case 'stomp': {
      const lift = Math.max(0, Math.sin(t * 9));
      return { ...s, hipsY: 0.91 - lift * 0.08, torso: 0.18, head: 0.4, thighR: -lift * 0.9, kneeR: lift * 1.2, shoulder: -0.4, elbow: -0.9 };
    }
    case 'cheer':
      return { ...s, spreadL: 2.6 + Math.sin(t * 8) * 0.2, spreadR: 2.6 - Math.sin(t * 8) * 0.2, elbow: -0.2, head: -0.15 };
    case 'listen':
      return { ...s, head: 0.05, headTurn: 0, shoulderL: -0.6, elbowL: -1.2, shoulderR: -0.08, elbowR: -0.25 };
    default:
      return { ...s, headTurn: Math.sin(t * 0.5 + i) * 0.3 };
  }
}

function leapPose() {
  return { ...POSE.stand, hipsY: 0.86, torso: 0.2, thighL: -1.1, thighR: -0.3, kneeL: 1.3, kneeR: 0.9, shoulder: -2.2, elbow: -0.4, spreadL: 0.3, spreadR: 0.3 };
}

/* ---------- page geometry ---------- */

let viewW = window.innerWidth;
let viewH = window.innerHeight;
let figurePx = 64;

const claims = new Map();

function usable(element) {
  if (!element || !element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  return rect.width >= 90 && rect.height > 0 && element.getClientRects().length > 0;
}

function spotPoint(spot) {
  const rect = spot.el.getBoundingClientRect();
  return { x: rect.left + spot.u * rect.width, y: rect.top, rect };
}

function clampU(element, u) {
  const width = element.getBoundingClientRect().width || 1;
  const margin = Math.min(0.45, (figurePx * 0.45) / width);
  return Math.min(1 - margin, Math.max(margin, u));
}

function inView(y, pad = 0) {
  return y > 70 - pad && y < viewH + pad;
}

/* ---------- agents ---------- */

const agentsLayer = new THREE.Group();
scene.add(agentsLayer);
const fxLayer = new THREE.Group();
scene.add(fxLayer);

const bubbleLayer = document.createElement('div');
bubbleLayer.className = 'agent-roam__bubbles';
layer.append(bubbleLayer);

let liveCounts = null;
const liveStatus = new Map();

const roamers = [...AGENTS, APPLICANT].map((agent, index) => {
  const holder = new THREE.Group();
  agentsLayer.add(holder);
  const rig = createPerson(agent, holder);
  const props = buildProps(rig, agent);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2 + 0.35;
  holder.add(shadow);

  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.tabIndex = -1;
  bubble.className = 'agent-bubble';
  bubble.style.setProperty('--agent-accent', `#${agent.accent.toString(16).padStart(6, '0')}`);
  bubble.innerHTML = '<strong></strong><span></span>';
  bubble.querySelector('strong').textContent = agent.name.split(' ')[0];
  bubble.addEventListener('click', () => openInOffice(agent.id));
  bubbleLayer.append(bubble);

  return {
    agent, index, holder, rig, props, shadow, bubble,
    first: agent.name.split(' ')[0],
    state: 'idle',
    timer: 0.3 + index * 0.45,
    spot: null,
    task: null,
    line: '',
    from: null,
    progress: 0,
    duration: 1,
    facing: 0,
    stride: index,
    scale: 1,
    override: null,
    overrideTimer: 0,
    queued: null,
    visible: false,
  };
});

function openInOffice(id) {
  const figure = document.querySelector(`.agent-figure[data-agent="${id}"]`);
  const network = figure ? document.getElementById('agentNetwork') : document.getElementById('ai-work');
  if (network) network.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
  if (figure) figure.click();
}

function release(roamer) {
  if (roamer.spot && claims.get(roamer.spot.el) === roamer) claims.delete(roamer.spot.el);
}

function sayLine(task, roamer) {
  const options = task.lines.length ? task.lines : [''];
  const pick = options[Math.floor(Math.random() * options.length)];
  const text = typeof pick === 'function' ? pick(liveCounts, { ...roamer.agent, first: roamer.first }) : pick;
  return text || task.lines.find((line) => typeof line === 'string') || '';
}

function candidateElements(selectors, allowClaimed = false) {
  const out = [];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (!allowClaimed && claims.has(element)) continue;
      if (usable(element)) out.push(element);
    }
  }
  return out;
}

// Prefer places near what the visitor is reading, so the team follows them
// down the page instead of all sitting somewhere out of sight.
function weightFor(element, wantInView) {
  const rect = element.getBoundingClientRect();
  if (wantInView) return inView(rect.top, -40) ? 1 : 0;
  const distance = Math.abs(rect.top - viewH * 0.5) / viewH;
  return inView(rect.top) ? 3 : 1 / (1 + distance * 1.5);
}

function weightedPick(items, weigh) {
  const weights = items.map(weigh);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function chooseTask(roamer, wantInView = false) {
  const status = liveStatus.get(roamer.agent.id);
  if (status === 'running') {
    const element = document.getElementById('agentNetwork');
    if (usable(element)) return { taskId: 'live', element };
  }
  const own = ROSTER[roamer.agent.id];
  const pool = Math.random() < 0.3 ? SHARED : own;
  const order = [...pool].sort(() => Math.random() - 0.5);
  for (const taskId of order) {
    if (roamer.task === taskId && order.length > 1) continue;
    const elements = candidateElements(TASKS[taskId].spots);
    const element = weightedPick(elements, (el) => weightFor(el, wantInView));
    if (element) return { taskId, element };
  }
  return null;
}

function startTask(roamer, taskId, element, u = null, line = null) {
  release(roamer);
  const task = TASKS[taskId];
  const target = { el: element, u: clampU(element, u ?? (0.15 + Math.random() * 0.7)) };
  claims.set(element, roamer);
  roamer.task = taskId;
  roamer.line = line ?? sayLine(task, roamer);
  travelTo(roamer, target);
}

function screenPos(roamer) {
  if (!roamer.spot) return null;
  return spotPoint(roamer.spot);
}

function travelTo(roamer, target) {
  const here = screenPos(roamer);
  const there = spotPoint(target);
  roamer.target = target;
  roamer.progress = 0;
  setBubble(roamer, false);
  if (!here) {
    roamer.state = 'portal-in';
    roamer.spot = target;
    roamer.duration = 0.45;
    spawnRing(roamer, there.x, there.y);
    return;
  }
  const sameElement = roamer.spot.el === target.el;
  const dx = there.x - here.x;
  const dy = there.y - here.y;
  const distance = Math.hypot(dx, dy);
  roamer.facing = dx >= 0 ? 1 : -1;
  if (sameElement) {
    roamer.state = 'walk';
    roamer.from = { u: roamer.spot.u };
    const speed = Math.abs(dx) > 220 ? 230 : 95;
    roamer.duration = Math.max(0.3, Math.abs(dx) / speed);
  } else if (inView(here.y, 60) && inView(there.y, 60) && distance < Math.max(560, viewW * 0.6)) {
    roamer.state = 'leap';
    roamer.from = { x: here.x, y: here.y + window.scrollY };
    roamer.duration = 0.55 + distance / 1300;
    roamer.arc = Math.min(220, 70 + distance * 0.3);
  } else {
    roamer.state = 'portal-out';
    roamer.duration = 0.4;
    if (inView(here.y, 80)) spawnRing(roamer, here.x, here.y);
  }
}

function arrive(roamer) {
  roamer.spot = roamer.target;
  roamer.target = null;
  roamer.state = 'work';
  const task = TASKS[roamer.task];
  roamer.timer = task === TASKS.squash ? 1.6 : 7 + Math.random() * 6;
  const point = spotPoint(roamer.spot);
  roamer.facing = point.x < point.rect.left + point.rect.width / 2 ? 1 : -1;
  if (roamer.task === 'handoff' && roamer.partner) {
    const partner = roamer.partner;
    if (partner.state === 'work') {
      partner.override = { anim: 'listen', line: `Thanks, ${roamer.first}!` };
      partner.overrideTimer = 3.2;
      partner.facing = point.x < spotPoint(partner.spot).x ? -1 : 1;
      roamer.facing = -partner.facing;
    }
    roamer.timer = 3.4;
  }
  if (roamer.task === 'squash') {
    if (roamer.bug) squashBug(roamer.bug);
    else roamer.line = 'It got away. Ticket logged';
  }
  setBubble(roamer, true);
}

function setBubble(roamer, on, text = null) {
  roamer.bubbleOn = on;
  if (on) roamer.bubble.querySelector('span').textContent = text ?? roamer.line;
}

function pickNext(roamer) {
  roamer.partner = null;
  roamer.bug = null;
  // Now and then, carry work to a teammate who is in view.
  if (Math.random() < 0.18 && !liveStatus.size) {
    const partners = roamers.filter((other) => other !== roamer && other.state === 'work' && !other.override
      && other.task !== 'handoff' && other.spot && inView(spotPoint(other.spot).y));
    if (partners.length) {
      const partner = partners[Math.floor(Math.random() * partners.length)];
      const side = partner.spot.u > 0.5 ? -1 : 1;
      const width = partner.spot.el.getBoundingClientRect().width;
      const u = partner.spot.u + side * Math.min(0.3, (figurePx * 0.95) / width);
      roamer.partner = partner;
      startTask(roamer, 'handoff', partner.spot.el, u, HANDOFF_LINES[roamer.agent.id](partner.first));
      claims.set(partner.spot.el, partner);
      return;
    }
  }
  const choice = chooseTask(roamer);
  if (choice) startTask(roamer, choice.taskId, choice.element);
  else roamer.timer = 2;
}

/* ---------- effects: portal rings and bugs ---------- */

const rings = [];
function spawnRing(roamer, x, y) {
  const ring = new THREE.Mesh(torus(0.5, 0.05, 6, 32), new THREE.MeshBasicMaterial({
    color: roamer.agent.accent, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  ring.rotation.x = Math.PI / 2 - 0.35;
  ring.position.set(x, -y, 50);
  fxLayer.add(ring);
  const beam = new THREE.Mesh(cylinder(0.42, 0.5, 2.2, 20), new THREE.MeshBasicMaterial({
    color: roamer.agent.accent, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  beam.position.set(x, -y + figurePx * 0.6, 40);
  fxLayer.add(beam);
  rings.push({ ring, beam, age: 0, life: 0.7 });
}

function updateRings(delta) {
  for (let i = rings.length - 1; i >= 0; i -= 1) {
    const item = rings[i];
    item.age += delta;
    const k = item.age / item.life;
    const size = figurePx * (0.35 + k * 0.6);
    item.ring.scale.setScalar(size);
    item.ring.material.opacity = 0.9 * (1 - k);
    item.beam.scale.set(figurePx * 0.5 * (1 - k * 0.5), figurePx * 0.55, figurePx * 0.5 * (1 - k * 0.5));
    item.beam.material.opacity = 0.28 * (1 - k);
    if (k >= 1) {
      fxLayer.remove(item.ring, item.beam);
      item.ring.material.dispose();
      item.beam.material.dispose();
      rings.splice(i, 1);
    }
  }
}

const bugMaterial = new THREE.MeshStandardMaterial({ color: 0xd4705f, roughness: 0.45, emissive: 0x5a1d14, emissiveIntensity: 0.4 });
const bugLegMaterial = material(0x2a2224, { roughness: 0.6 });
let bug = null;
let bugTimer = 9;

function makeBugMesh() {
  const group = new THREE.Group();
  mesh(sphere(0.5, 12, 8), bugMaterial, group, [0, 0.35, 0], { scale: [1.25, 0.7, 0.9], cast: false });
  mesh(sphere(0.28, 10, 8), bugLegMaterial, group, [0.62, 0.38, 0], { cast: false });
  mesh(box(0.04, 0.5, 0.04), bugLegMaterial, group, [0.08, 0.62, 0], { cast: false });
  const legs = [];
  for (const offset of [-0.35, 0, 0.35]) {
    const leg = mesh(box(0.06, 0.45, 0.06), bugLegMaterial, group, [offset, 0.16, 0.3], { cast: false });
    legs.push(leg);
  }
  group.userData.legs = legs;
  return group;
}

function spawnBug() {
  const elements = candidateElements(['.skill-card', '.timeline__content', '.ai-work__card', '.edu-card', '.section__eyebrow', '.contact__form', '.hero__stat'], true)
    .filter((element) => inView(element.getBoundingClientRect().top, -60));
  if (!elements.length) return;
  const element = elements[Math.floor(Math.random() * elements.length)];
  const meshGroup = makeBugMesh();
  fxLayer.add(meshGroup);
  bug = { el: element, u: 0.1 + Math.random() * 0.8, dir: Math.random() < 0.5 ? -1 : 1, mesh: meshGroup, age: 0, life: 14, squashed: 0, hunter: null };

  // The nearest free engineer goes after it; the reviewer if she's close.
  const point = spotPoint(bug);
  let best = null;
  let bestScore = Infinity;
  for (const roamer of roamers) {
    if (!roamer.spot || roamer.task === 'live' || roamer.task === 'handoff' || roamer.state !== 'work') continue;
    const here = spotPoint(roamer.spot);
    let score = Math.hypot(here.x - point.x, here.y - point.y);
    if (roamer.agent.id === 'application-reviewer') score *= 0.6;
    if (score < bestScore) {
      best = roamer;
      bestScore = score;
    }
  }
  if (best) {
    bug.hunter = best;
    best.bug = bug;
    best.partner = null;
    best.task = 'squash';
    best.line = sayLine(TASKS.squash, best);
    release(best);
    travelTo(best, { el: element, u: bug.u });
  }
}

function squashBug(target) {
  target.squashed = 0.001;
  const point = spotPoint(target);
  spawnRing({ agent: { accent: 0x7fd4b4 } }, point.x, point.y);
}

function updateBug(delta) {
  if (!bug) return;
  bug.age += delta;
  if (!bug.el.isConnected) bug.age = bug.life;
  const rect = bug.el.getBoundingClientRect();
  if (!bug.squashed) {
    bug.u += bug.dir * delta * (38 / Math.max(120, rect.width));
    if (bug.u < 0.06 || bug.u > 0.94) bug.dir *= -1;
    // Keep the hunter's destination on the bug as it crawls.
    if (bug.hunter && bug.hunter.target && bug.hunter.target.el === bug.el) bug.hunter.target.u = bug.u;
  } else {
    bug.squashed += delta;
  }
  const size = figurePx * 0.17;
  const x = rect.left + bug.u * rect.width;
  bug.mesh.position.set(x, -rect.top, 30);
  bug.mesh.rotation.y = bug.dir > 0 ? 0.25 : Math.PI - 0.25;
  const flatten = bug.squashed ? Math.max(0.05, 1 - bug.squashed * 3) : 1;
  bug.mesh.scale.set(size * (bug.squashed ? 1.3 : 1), size * flatten, size);
  bug.mesh.userData.legs.forEach((leg, i) => { leg.rotation.z = Math.sin(bug.age * 22 + i * 2) * 0.5; });
  if (bug.squashed > 0.9 || (!bug.squashed && bug.age > bug.life)) {
    fxLayer.remove(bug.mesh);
    if (bug.hunter && bug.hunter.bug === bug) bug.hunter.bug = null;
    bug = null;
    bugTimer = 16 + Math.random() * 14;
  }
}

/* ---------- per-frame update ---------- */

function placeRoamer(roamer, x, y, delta, time) {
  const { rig, holder } = roamer;
  const task = TASKS[roamer.task] || {};
  const anim = roamer.override?.anim || task.anim;
  const scale = (figurePx / 1.8) * roamer.scale;
  let lift = 0;
  let pose;
  let facingAngle;

  switch (roamer.state) {
    case 'walk':
      roamer.stride += delta * 9;
      pose = walkPose(roamer.stride);
      if (task.carry) pose = { ...pose, shoulderL: -0.95, shoulderR: -0.95, elbow: -0.95 };
      lift = Math.abs(Math.sin(roamer.stride)) * 0.03;
      facingAngle = roamer.facing * 1.25;
      break;
    case 'leap': {
      const k = roamer.progress;
      pose = leapPose();
      if (task.carry) pose = { ...pose, shoulder: -0.95, elbow: -0.95, spreadL: 0.1, spreadR: 0.1 };
      facingAngle = roamer.facing * 1.1;
      holder.rotation.z = -roamer.facing * Math.sin(k * Math.PI) * 0.25;
      break;
    }
    case 'portal-out':
    case 'portal-in':
      pose = { ...POSE.stand, spreadL: 0.5, spreadR: 0.5 };
      facingAngle = 0;
      break;
    case 'work':
    default: {
      pose = taskPose(anim, time, roamer.index);
      const turn = anim === 'wave' || anim === 'cheer' ? 0 : 0.42;
      facingAngle = roamer.facing * turn;
      if (anim === 'stomp') lift = Math.max(0, Math.sin(time * 9)) * 0.12;
      if (anim === 'cheer') lift = Math.max(0, Math.sin(time * 8)) * 0.18;
    }
  }
  if (roamer.state !== 'leap') holder.rotation.z = approach(holder.rotation.z, 0, delta, 10);

  const sitting = roamer.state === 'work' && (roamer.override ? false : task.sit);
  // When seated on the edge, drop the figure so the hips sit on the ledge.
  const seatDrop = sitting ? LEDGE_SIT.hipsY * roamer.agent.build : 0;
  holder.position.set(x, -y - seatDrop * scale + lift * scale, 0);
  holder.scale.setScalar(scale);
  rig.root.rotation.y = approach(rig.root.rotation.y, facingAngle, delta, 8);
  applyPose(rig, pose, delta);
  roamer.shadow.position.y = seatDrop + 0.005 - lift;
  roamer.shadow.visible = roamer.state !== 'leap';

  const propName = PROP_FOR[anim];
  const showCarry = Boolean(task.carry) && roamer.state !== 'portal-out' && roamer.state !== 'portal-in';
  for (const [name, prop] of Object.entries(roamer.props)) {
    prop.visible = (roamer.state === 'work' && name === propName) || (showCarry && name === 'parcel');
  }
}

function updateRoamer(roamer, delta, time) {
  if (roamer.overrideTimer > 0) {
    roamer.overrideTimer -= delta;
    if (roamer.overrideTimer <= 0) roamer.override = null;
  }

  if (roamer.state === 'idle') {
    roamer.timer -= delta;
    if (roamer.timer <= 0) pickNext(roamer);
  } else if (roamer.state === 'work') {
    roamer.timer -= delta;
    if (roamer.timer <= 0 || !roamer.spot.el.isConnected) {
      if (roamer.queued) {
        const { taskId, element, line } = roamer.queued;
        roamer.queued = null;
        startTask(roamer, taskId, element, null, line);
      } else {
        pickNext(roamer);
      }
    }
  } else {
    roamer.progress = Math.min(1, roamer.progress + delta / roamer.duration);
    if (roamer.progress >= 1) {
      if (roamer.state === 'portal-out') {
        roamer.state = 'portal-in';
        roamer.spot = roamer.target;
        roamer.progress = 0;
        roamer.duration = 0.45;
        const there = spotPoint(roamer.target);
        if (inView(there.y, 80)) spawnRing(roamer, there.x, there.y);
      } else {
        arrive(roamer);
      }
    }
  }

  // Resolve the current screen position from the live page layout.
  let x;
  let y;
  roamer.scale = 1;
  if (roamer.state === 'walk') {
    const u = roamer.from.u + (roamer.target.u - roamer.from.u) * easeInOut(roamer.progress);
    const point = spotPoint({ el: roamer.target.el, u });
    x = point.x;
    y = point.y;
  } else if (roamer.state === 'leap') {
    const there = spotPoint(roamer.target);
    const k = roamer.progress;
    const startY = roamer.from.y - window.scrollY;
    x = roamer.from.x + (there.x - roamer.from.x) * k;
    y = startY + (there.y - startY) * k - Math.sin(k * Math.PI) * roamer.arc;
  } else if (roamer.spot) {
    const point = spotPoint(roamer.spot);
    x = point.x;
    y = point.y;
    if (roamer.state === 'portal-out') roamer.scale = 1 - easeInOut(roamer.progress);
    if (roamer.state === 'portal-in') roamer.scale = easeInOut(roamer.progress);
  } else {
    roamer.holder.visible = false;
    roamer.visible = false;
    return;
  }

  roamer.scale = Math.max(0.001, roamer.scale);
  const visible = x > -figurePx && x < viewW + figurePx && y > -20 && y < viewH + figurePx * 1.4;
  roamer.visible = visible;
  roamer.holder.visible = visible;
  roamer.screen = { x, y };
  if (visible) placeRoamer(roamer, x, y, delta, time);
}

function easeInOut(k) {
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

function updateBubbles() {
  // One bubble per crowded area: closer bubbles than this hide the later one.
  const shown = [];
  for (const roamer of roamers) {
    const { bubble } = roamer;
    const text = roamer.override?.line;
    if (text && roamer.bubble.dataset.override !== text) {
      bubble.querySelector('span').textContent = text;
      bubble.dataset.override = text;
    } else if (!text && bubble.dataset.override) {
      bubble.querySelector('span').textContent = roamer.line;
      delete bubble.dataset.override;
    }
    let show = roamer.visible && roamer.bubbleOn && roamer.state === 'work' && roamer.screen
      && roamer.screen.y > 110 && roamer.screen.y < viewH - 10;
    if (show) {
      const sitting = !roamer.override && TASKS[roamer.task]?.sit;
      const top = roamer.screen.y - figurePx * (sitting ? 0.72 : 1.08) - 10;
      const clash = shown.some((other) => Math.abs(other.x - roamer.screen.x) < 240 && Math.abs(other.y - top) < 46);
      if (clash) show = false;
      else {
        shown.push({ x: roamer.screen.x, y: top });
        const x = Math.min(viewW - 100, Math.max(100, roamer.screen.x));
        bubble.style.transform = `translate3d(${x}px, ${top}px, 0) translate(-50%, -100%)`;
      }
    }
    bubble.classList.toggle('is-shown', show);
  }
}

// Keep a couple of engineers near whatever the visitor is reading.
let crowdTimer = 2;
function keepCompany(delta) {
  crowdTimer -= delta;
  if (crowdTimer > 0) return;
  crowdTimer = 3.5;
  const nearby = roamers.filter((roamer) => roamer.spot && inView(spotPoint(roamer.spot).y, 40)).length;
  const wanted = viewW < 680 ? 1 : 2;
  if (nearby >= wanted) return;
  const away = roamers.filter((roamer) => roamer.state === 'work' && roamer.task !== 'live' && roamer.task !== 'squash'
    && !roamer.partner && roamer.spot && !inView(spotPoint(roamer.spot).y, 200));
  if (!away.length) return;
  const roamer = away[Math.floor(Math.random() * away.length)];
  const choice = chooseTask(roamer, true);
  if (choice) startTask(roamer, choice.taskId, choice.element);
}

/* ---------- loop, sizing, events ---------- */

let running = false;
let frame = 0;
let lastTime = 0;
let drewSomething = true;

function resize() {
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  figurePx = viewW < 680 ? 54 : viewW < 1100 ? 70 : 84;
  renderer.setSize(viewW, viewH, false);
  camera.left = 0;
  camera.right = viewW;
  camera.top = 0;
  camera.bottom = -viewH;
  camera.updateProjectionMatrix();
}

function tick(now) {
  frame = running ? window.requestAnimationFrame(tick) : 0;
  const delta = Math.min(0.05, lastTime ? (now - lastTime) / 1000 : 0.016);
  lastTime = now;
  const time = now / 1000;

  for (const roamer of roamers) updateRoamer(roamer, delta, time);
  keepCompany(delta);
  bugTimer -= delta;
  if (!bug && bugTimer <= 0) {
    spawnBug();
    if (!bug) bugTimer = 6;
  }
  updateBug(delta);
  updateRings(delta);
  updateBubbles();

  // Skip the GPU work entirely while nothing is on screen.
  const anything = roamers.some((roamer) => roamer.visible) || rings.length > 0 || Boolean(bug);
  if (anything || drewSomething) renderer.render(scene, camera);
  drewSomething = anything;
}

function setRunning(on) {
  running = on;
  layer.hidden = !on;
  document.documentElement.classList.toggle('agents-roaming', on);
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(on));
    toggle.title = on ? 'Hide the roaming agents' : 'Let the agents roam the page';
    const label = toggle.querySelector('[data-roam-label]');
    if (label) label.textContent = on ? 'Agents on' : 'Agents off';
  }
  if (on && !frame) {
    lastTime = 0;
    frame = window.requestAnimationFrame(tick);
  } else if (!on && frame) {
    window.cancelAnimationFrame(frame);
    frame = 0;
  }
}

window.addEventListener('resize', resize, { passive: true });

window.addEventListener('agent-status-update', (event) => {
  const detail = event.detail || {};
  const counts = detail.counts;
  liveCounts = counts && Number.isInteger(counts.discovered) ? counts : null;
  liveStatus.clear();
  if (detail.run_status === 'running' && Array.isArray(detail.agents)) {
    for (const entry of detail.agents) if (entry.status === 'running') liveStatus.set(entry.id, 'running');
  }
  // Engineers on a live run head back to the office when their task ends.
  for (const roamer of roamers) {
    if (liveStatus.get(roamer.agent.id) === 'running' && roamer.task !== 'live' && roamer.state === 'work') {
      roamer.timer = Math.min(roamer.timer, 1.5);
    }
  }
});

const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', () => {
    let spoke = false;
    for (const roamer of roamers) {
      if (!roamer.visible || roamer.state !== 'work') continue;
      roamer.override = { anim: 'cheer', line: spoke ? '' : sayLine(TASKS.cheer, roamer) };
      roamer.overrideTimer = 2.8;
      spoke = true;
    }
  });
}

if (toggle) {
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    const on = !running;
    writePreference(on);
    setRunning(on);
  });
}

resize();
setRunning(readPreference());
window.agentRoamReady = true;

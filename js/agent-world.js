import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const AGENTS = [
  { id: 'role-scout', name: 'Mira Patel', role: 'Role Scout', color: 0x2d776f, skin: 0xc88967, hair: 0x30272a, tool: 0xe0ad55, archetype: 'pathfinder' },
  { id: 'fit-analyst', name: 'Arjun Rao', role: 'Fit Analyst', color: 0x3d6b98, skin: 0xd7a37a, hair: 0x3c312c, tool: 0xe1a954, archetype: 'guardian' },
  { id: 'resume-tailor', name: 'Leena Das', role: 'Resume Tailor', color: 0xa75b42, skin: 0xb87958, hair: 0x32292b, tool: 0xd6bd61, archetype: 'cape' },
  { id: 'application-writer', name: 'Kabir Shah', role: 'Application Writer', color: 0x677f42, skin: 0xe2b48c, hair: 0x49362d, tool: 0xd88e50, archetype: 'swift' },
  { id: 'application-reviewer', name: 'Nisha Menon', role: 'Application Reviewer', color: 0x906341, skin: 0xc68365, hair: 0x29282a, tool: 0xd8bf6a, archetype: 'sentinel' },
  { id: 'application-coordinator', name: 'Dev Malhotra', role: 'Application Coordinator', color: 0x337989, skin: 0xd29b76, hair: 0x382b28, tool: 0xe0ad55, archetype: 'captain' },
  { id: 'feedback-analyst', name: 'Tara Iyer', role: 'Feedback Analyst', color: 0x796284, skin: 0xc58a6a, hair: 0x33282d, tool: 0xd6bd61, archetype: 'oracle' },
];

const canvas = document.getElementById('agentNetworkCanvas');
const fallback = document.getElementById('agentNetworkFallback');
const sceneRoot = document.getElementById('agentNetwork');
if (!canvas || !sceneRoot) throw new Error('Agent network scene elements are missing.');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe3ebe5);
scene.fog = new THREE.Fog(0xe3ebe5, 19, 34);

const camera = new THREE.OrthographicCamera(-8, 8, 5.5, -5.5, 0.1, 80);
camera.position.set(0, 12, 14);
camera.lookAt(0, 0, 0);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
} catch (error) {
  canvas.hidden = true;
  fallback.hidden = false;
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

scene.add(new THREE.HemisphereLight(0xf8fff8, 0x78908a, 2.1));
const keyLight = new THREE.DirectionalLight(0xfff3de, 3.1);
keyLight.position.set(-6, 12, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -10;
keyLight.shadow.camera.right = 10;
keyLight.shadow.camera.top = 10;
keyLight.shadow.camera.bottom = -10;
scene.add(keyLight);

const world = new THREE.Group();
scene.add(world);
const linkRoot = new THREE.Group();
world.add(linkRoot);
const breakRoot = new THREE.Group();
world.add(breakRoot);

function material(color, roughness = 0.7, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
}

function mesh(geometry, mat, parent, position, cast = true) {
  const item = new THREE.Mesh(geometry, mat);
  item.position.set(...position);
  item.castShadow = cast;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

const floorMat = material(0xe8eee8, 0.96);
const floor = mesh(new THREE.CylinderGeometry(7.9, 8.15, 0.36, 72), floorMat, world, [0, -0.24, 0], false);
floor.receiveShadow = true;

const lineMat = new THREE.LineBasicMaterial({ color: 0x9bb1a8, transparent: true, opacity: 0.26 });
for (let step = -7; step <= 7; step += 1) {
  const pointsA = [new THREE.Vector3(step, -0.045, -7), new THREE.Vector3(step, -0.045, 7)];
  const pointsB = [new THREE.Vector3(-7, -0.045, step), new THREE.Vector3(7, -0.045, step)];
  world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pointsA), lineMat));
  world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pointsB), lineMat));
}

for (const radius of [2.15, 3.9, 6.7]) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius === 2.15 ? 0.018 : 0.012, 5, 120),
    material(radius === 2.15 ? 0x5e9e8b : 0x9eb8a9, 0.6, 0.25),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.035;
  world.add(ring);
}

const central = new THREE.Group();
world.add(central);
const baseMat = material(0x294d4b, 0.35, 0.32);
mesh(new THREE.CylinderGeometry(1.16, 1.27, 0.2, 12), baseMat, central, [0, 0.09, 0]);
mesh(new THREE.CylinderGeometry(0.88, 0.98, 0.19, 12), material(0x4b8880, 0.45, 0.22), central, [0, 0.28, 0]);

const portalMat = new THREE.MeshStandardMaterial({
  color: 0x77d4bd, emissive: 0x328d79, emissiveIntensity: 0.65, roughness: 0.3, metalness: 0.35,
});
const gate = mesh(new THREE.TorusGeometry(0.69, 0.075, 10, 56), portalMat, central, [0, 1.17, 0]);
gate.scale.set(0.88, 1.12, 1);
mesh(new THREE.BoxGeometry(0.12, 1.45, 0.12), baseMat, central, [-0.62, 0.83, 0]);
mesh(new THREE.BoxGeometry(0.12, 1.45, 0.12), baseMat, central, [0.62, 0.83, 0]);
mesh(new THREE.BoxGeometry(1.42, 0.12, 0.14), baseMat, central, [0, 1.58, 0]);
const core = mesh(
  new THREE.OctahedronGeometry(0.27, 0),
  new THREE.MeshStandardMaterial({ color: 0xffcb72, emissive: 0xc2782f, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.28 }),
  central,
  [0, 1.15, 0.04],
);

const roleTools = [];
const nodeGroups = new Map();
const personGroups = new Map();
const agentMotion = new Map();
const stationLinks = [];
const packetMeshes = [];
const linkMaterial = new THREE.LineBasicMaterial({ color: 0x5f9a88, transparent: true, opacity: 0.52 });
const linkPacketMaterial = new THREE.MeshStandardMaterial({ color: 0xe6a74f, emissive: 0xa95d30, emissiveIntensity: 0.62, roughness: 0.35 });

function createEngineer(agent, position, angle) {
  const node = new THREE.Group();
  node.position.set(position.x, 0, position.z);
  node.rotation.y = angle;
  node.userData.agentId = agent.id;
  world.add(node);
  nodeGroups.set(agent.id, node);

  const accent = material(agent.color, 0.38, 0.18);
  const skin = material(agent.skin, 0.86);
  const hair = material(agent.hair, 0.92);
  const trim = material(agent.tool, 0.4, 0.2);
  const highlight = material(agent.tool, 0.35, 0.28);
  const deskMat = material(0x687c70, 0.46, 0.17);
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x23454a, emissive: agent.color, emissiveIntensity: 0.22, roughness: 0.36 });

  const platform = mesh(new THREE.CylinderGeometry(0.93, 1.0, 0.13, 32), material(0xd6e0d8, 0.56, 0.08), node, [0, 0.04, 0]);
  platform.userData.agentId = agent.id;
  const halo = mesh(new THREE.TorusGeometry(0.83, 0.035, 6, 42), accent, node, [0, 0.12, 0], false);
  halo.rotation.x = Math.PI / 2;
  halo.material = halo.material.clone();
  halo.material.transparent = true;
  halo.material.opacity = 0.62;
  halo.userData.baseOpacity = 0.62;
  roleTools.push({ id: agent.id, halo });

  const desk = mesh(new THREE.BoxGeometry(1.12, 0.12, 0.62), deskMat, node, [0, 0.75, 0.5]);
  desk.userData.agentId = agent.id;
  for (const x of [-0.46, 0.46]) {
    for (const z of [0.29, 0.71]) mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.71, 6), deskMat, node, [x, 0.38, z]);
  }

  const screen = mesh(new THREE.BoxGeometry(0.53, 0.36, 0.055), screenMat, node, [0, 1.02, 0.69]);
  screen.rotation.x = -0.13;
  screen.userData.agentId = agent.id;
  mesh(new THREE.BoxGeometry(0.62, 0.035, 0.34), material(0x374d4b, 0.44, 0.18), node, [0, 0.84, 0.49]);
  mesh(new THREE.BoxGeometry(0.27, 0.025, 0.15), trim, node, [0.26, 0.84, 0.31]);

  const person = new THREE.Group();
  person.position.set(
    position.x - Math.sin(angle) * 0.38,
    0,
    position.z - Math.cos(angle) * 0.38,
  );
  person.rotation.y = angle;
  person.userData.agentId = agent.id;
  world.add(person);
  personGroups.set(agent.id, person);
  const torso = mesh(new THREE.BoxGeometry(0.43, 0.55, 0.29), accent, person, [0, 0.93, 0]);
  torso.userData.agentId = agent.id;
  torso.rotation.x = -0.06;
  mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.18, 8), skin, person, [0, 1.27, 0]);
  const head = mesh(new THREE.SphereGeometry(0.205, 12, 9), skin, person, [0, 1.48, 0.015]);
  head.userData.agentId = agent.id;
  mesh(new THREE.SphereGeometry(0.21, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.54), hair, person, [0, 1.52, -0.018]);
  mesh(new THREE.BoxGeometry(0.11, 0.1, 0.21), hair, person, [-0.16, 1.43, 0.035]);
  mesh(new THREE.BoxGeometry(0.11, 0.1, 0.21), hair, person, [0.16, 1.43, 0.035]);
  for (const side of [-1, 1]) {
    const arm = mesh(new THREE.BoxGeometry(0.14, 0.43, 0.16), accent, person, [side * 0.29, 0.91, 0.09]);
    arm.rotation.x = -0.36;
    arm.rotation.z = side * -0.08;
    mesh(new THREE.SphereGeometry(0.075, 8, 6), skin, person, [side * 0.29, 0.72, 0.22]);
    const leg = mesh(new THREE.BoxGeometry(0.16, 0.4, 0.19), material(0x344c4c, 0.82), person, [side * 0.12, 0.25, -0.01]);
    leg.userData.agentId = agent.id;
    mesh(new THREE.BoxGeometry(0.2, 0.12, 0.31), material(0x263d41, 0.68), person, [side * 0.12, 0.065, 0.04]);
  }

  if (agent.archetype === 'guardian') {
    torso.scale.set(1.24, 1.04, 1.18);
    for (const side of [-1, 1]) {
      const pauldron = mesh(new THREE.SphereGeometry(0.16, 8, 6), trim, person, [side * 0.31, 1.13, 0]);
      pauldron.scale.set(1.15, 0.75, 1.0);
      mesh(new THREE.BoxGeometry(0.1, 0.22, 0.035), highlight, person, [side * 0.11, 0.96, 0.16], false);
    }
  } else if (agent.archetype === 'pathfinder') {
    const hood = mesh(new THREE.SphereGeometry(0.265, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.7), accent, person, [0, 1.51, -0.035]);
    hood.scale.set(1.07, 1.1, 1.0);
    mesh(new THREE.BoxGeometry(0.42, 0.08, 0.06), trim, person, [0, 1.58, 0.12]);
  } else if (agent.archetype === 'cape') {
    const capeMaterial = new THREE.MeshStandardMaterial({ color: agent.color, roughness: 0.82, side: THREE.DoubleSide, flatShading: true });
    const cape = mesh(new THREE.CylinderGeometry(0.2, 0.43, 0.74, 5, 1, true), capeMaterial, person, [0, 0.91, -0.2]);
    cape.rotation.x = -0.11;
    mesh(new THREE.OctahedronGeometry(0.09, 0), trim, person, [0, 1.18, 0.16]);
  } else if (agent.archetype === 'swift') {
    mesh(new THREE.TorusGeometry(0.23, 0.035, 5, 18), trim, person, [0, 1.47, 0], false).rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.21, 0.09, 0.27), highlight, person, [side * 0.29, 1.03, -0.02]);
    }
  } else if (agent.archetype === 'sentinel') {
    const visor = mesh(new THREE.BoxGeometry(0.4, 0.095, 0.06), highlight, person, [0, 1.49, 0.18]);
    visor.material.emissive = new THREE.Color(agent.tool);
    visor.material.emissiveIntensity = 0.22;
    const shield = mesh(new THREE.TorusGeometry(0.2, 0.055, 6, 8), trim, person, [0.4, 0.92, -0.12]);
    shield.scale.set(0.8, 1.1, 0.5);
  } else if (agent.archetype === 'captain') {
    const crest = mesh(new THREE.ConeGeometry(0.13, 0.28, 5), trim, person, [0, 1.75, -0.005]);
    crest.rotation.z = Math.PI;
    mesh(new THREE.BoxGeometry(0.44, 0.1, 0.33), highlight, person, [0, 0.94, 0.15]);
    mesh(new THREE.OctahedronGeometry(0.085, 0), accent, person, [0, 0.94, 0.34]);
  } else if (agent.archetype === 'oracle') {
    const mantleMaterial = new THREE.MeshStandardMaterial({ color: agent.color, roughness: 0.76, side: THREE.DoubleSide, flatShading: true });
    const mantle = mesh(new THREE.CylinderGeometry(0.18, 0.4, 0.64, 4, 1, true), mantleMaterial, person, [0, 0.91, -0.19]);
    mantle.rotation.z = -0.1;
    mesh(new THREE.TorusGeometry(0.105, 0.027, 5, 12), highlight, person, [0, 1.72, 0]);
    mesh(new THREE.OctahedronGeometry(0.075, 0), trim, person, [0, 1.72, 0]);
  }

  const roleProp = new THREE.Group();
  roleProp.position.set(0.43, 0.91, 0.31);
  node.add(roleProp);
  switch (agent.id) {
    case 'role-scout':
      mesh(new THREE.TorusGeometry(0.11, 0.035, 6, 14), trim, roleProp, [0, 0.1, 0], false);
      mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 6), trim, roleProp, [0.1, 0, 0]);
      break;
    case 'fit-analyst':
      for (let i = 0; i < 3; i += 1) mesh(new THREE.BoxGeometry(0.09, 0.12 + i * 0.07, 0.07), trim, roleProp, [i * 0.12, 0.04, 0]);
      break;
    case 'resume-tailor':
      mesh(new THREE.BoxGeometry(0.2, 0.25, 0.04), material(0xfff7e8, 0.92), roleProp, [0, 0.07, 0]);
      mesh(new THREE.BoxGeometry(0.11, 0.018, 0.012), trim, roleProp, [0, 0.12, 0.027], false);
      mesh(new THREE.BoxGeometry(0.12, 0.018, 0.012), trim, roleProp, [0, 0.06, 0.027], false);
      break;
    case 'application-writer':
      mesh(new THREE.ConeGeometry(0.11, 0.27, 6), trim, roleProp, [0, 0.09, 0], false);
      break;
    case 'application-reviewer':
      mesh(new THREE.TorusGeometry(0.12, 0.027, 5, 12), trim, roleProp, [0, 0.08, 0], false);
      mesh(new THREE.BoxGeometry(0.045, 0.17, 0.04), trim, roleProp, [0.1, -0.045, 0]);
      break;
    case 'application-coordinator':
      mesh(new THREE.BoxGeometry(0.23, 0.2, 0.035), material(0xfff7e8, 0.9), roleProp, [0, 0.07, 0]);
      mesh(new THREE.TorusGeometry(0.065, 0.02, 5, 12, Math.PI), trim, roleProp, [0, 0.18, -0.005], false);
      break;
    default:
      mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 18), trim, roleProp, [0, 0.1, 0], false);
      mesh(new THREE.ConeGeometry(0.055, 0.13, 6), trim, roleProp, [0.13, 0.1, 0]);
  }
  roleProp.traverse((item) => { item.userData.agentId = agent.id; });
  return node;
}

function getPositions(mobile) {
  if (mobile) {
    return AGENTS.map((agent, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      return {
        position: { x: col === 0 ? -1.85 : 1.85, z: -2.5 + row * 2.15 },
        angle: col === 0 ? 0.42 : -0.42,
      };
    });
  }
  return AGENTS.map((agent, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / AGENTS.length;
    return {
      position: { x: Math.cos(angle) * 5.25, z: Math.sin(angle) * 4.6 },
      angle: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
    };
  });
}

function getBreakPositions(mobile) {
  if (mobile) {
    return [
      new THREE.Vector3(-2.1, 0, -3.4),
      new THREE.Vector3(2.1, 0, -1.25),
      new THREE.Vector3(-2.1, 0, 1.35),
      new THREE.Vector3(2.1, 0, 3.55),
    ];
  }
  return [
    new THREE.Vector3(-1.5, 0, -5.15),
    new THREE.Vector3(1.6, 0, 5.0),
    new THREE.Vector3(-5.8, 0, 0.3),
    new THREE.Vector3(5.8, 0, -0.35),
  ];
}

function createBreakAreas(mobile) {
  breakRoot.clear();
  const benchMaterial = material(0x9a7650, 0.78);
  const metalMaterial = material(0x586d64, 0.62, 0.12);
  const cupMaterial = material(0xf1e3c6, 0.45);
  for (const [index, point] of getBreakPositions(mobile).entries()) {
    const bench = new THREE.Group();
    bench.position.set(point.x, 0, point.z);
    bench.rotation.y = index % 2 ? Math.PI / 2 : 0;
    breakRoot.add(bench);
    mesh(new THREE.BoxGeometry(0.9, 0.11, 0.34), benchMaterial, bench, [0, 0.5, 0]);
    for (const side of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.08, 0.5, 0.28), metalMaterial, bench, [side * 0.31, 0.25, 0]);
    }
    mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.14, 8), cupMaterial, bench, [0.55, 0.61, 0]);
    mesh(new THREE.TorusGeometry(0.04, 0.014, 5, 10, Math.PI), cupMaterial, bench, [0.62, 0.62, 0]);
  }
}

let mobileLayout = window.matchMedia('(max-width: 680px)').matches;
let stationLayouts = getPositions(mobileLayout);
const agents = stationLayouts.map((layout, index) => createEngineer(AGENTS[index], layout.position, layout.angle));
const homePositions = AGENTS.map((agent) => personGroups.get(agent.id).position.clone());
createBreakAreas(mobileLayout);
AGENTS.forEach((agent, index) => {
  const home = homePositions[index].clone();
  const homeAngle = stationLayouts[index].angle;
  agentMotion.set(agent.id, {
    home,
    homeAngle,
    target: home.clone(),
    phase: 'home',
    pauseRemaining: 0.5 + (index % 4) * 0.6,
    loungeIndex: -1,
  });
});

function createLinks() {
  for (const child of linkRoot.children) {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((entry) => entry.dispose());
    else child.material?.dispose();
  }
  linkRoot.clear();
  stationLinks.length = 0;
  packetMeshes.length = 0;
  for (const [index, agent] of agents.entries()) {
    const p = agent.position;
    const points = [
      new THREE.Vector3(0, 0.08, 0),
      new THREE.Vector3(p.x * 0.34, 0.12, p.z * 0.29),
      new THREE.Vector3(p.x * 0.72, 0.12, p.z * 0.76),
      new THREE.Vector3(p.x, 0.12, p.z),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
      linkMaterial.clone(),
    );
    line.material.transparent = true;
    line.material.opacity = 0.34;
    linkRoot.add(line);

    const packet = mesh(new THREE.SphereGeometry(0.075, 8, 6), linkPacketMaterial.clone(), linkRoot, [0, 0.16, 0], false);
    packet.material.color.setHex(AGENTS[index].tool);
    packet.material.emissive.setHex(AGENTS[index].tool);
    packetMeshes.push({ packet, curve, agentId: AGENTS[index].id, phase: index / AGENTS.length });
    stationLinks.push({ line, agentId: AGENTS[index].id });
  }
}
createLinks();

const stars = new THREE.Group();
for (let index = 0; index < 96; index += 1) {
  const x = ((index * 37) % 151) / 10 - 7.5;
  const z = ((index * 61) % 151) / 10 - 7.5;
  const dot = mesh(new THREE.SphereGeometry(0.022, 4, 4), material(index % 3 ? 0x9fb8aa : 0xd5a45c, 0.9), stars, [x, -0.025, z], false);
  dot.scale.setScalar(index % 5 === 0 ? 1.7 : 1);
}
world.add(stars);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedId = 'role-scout';
let pointerDown = null;
let sceneTime = 0;
let frameHandle = 0;
let workflowMode = 'unknown';

const cards = [...document.querySelectorAll('.agent-figure[data-agent]')];
const selectedName = document.getElementById('agentNetworkName');
const selectedRole = document.getElementById('agentNetworkRole');
const selectedStatus = document.getElementById('agentNetworkAgentStatus');
const iconByAgent = {
  'role-scout': 'fa-binoculars',
  'fit-analyst': 'fa-chart-simple',
  'resume-tailor': 'fa-file-lines',
  'application-writer': 'fa-pen-to-square',
  'application-reviewer': 'fa-clipboard-check',
  'application-coordinator': 'fa-user-check',
  'feedback-analyst': 'fa-arrows-rotate',
};
const statusById = new Map(AGENTS.map((agent) => [agent.id, 'unknown']));

function currentStatusLabel(id) {
  const status = statusById.get(id);
  return ({
    unknown: 'Status unavailable',
    planned: 'Planned role',
    idle: 'Ready for run',
    running: 'Working now',
    completed: 'Stage complete',
    failed: 'Needs attention',
  })[status] || 'Status unavailable';
}

function selectAgent(id) {
  const agent = AGENTS.find((entry) => entry.id === id);
  if (!agent) return;
  selectedId = id;
  selectedName.textContent = agent.name;
  selectedRole.textContent = agent.role;
  selectedStatus.textContent = currentStatusLabel(id);
  const icon = document.querySelector('.agent-network__selection-mark i');
  icon.className = `fa-solid ${iconByAgent[id]}`;
  cards.forEach((card) => {
    const selected = card.dataset.agent === id;
    card.classList.toggle('is-selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
  window.dispatchEvent(new CustomEvent('agent-world-selected', { detail: { id } }));
  renderFrame(0);
}

window.addEventListener('agent-world-select-request', (event) => selectAgent(event.detail?.id));
const initiallySelected = cards.find((card) => card.getAttribute('aria-pressed') === 'true');
if (initiallySelected) selectedId = initiallySelected.dataset.agent;

window.addEventListener('agent-status-update', (event) => {
  const states = event.detail?.agents;
  if (!Array.isArray(states)) return;
  if (event.detail?.unavailable) {
    AGENTS.forEach((agent) => statusById.set(agent.id, 'unknown'));
    workflowMode = event.detail?.ambient === 'break' ? 'idle' : 'unknown';
  } else {
    const hasRunningAgent = states.some((state) => state.status === 'running');
    workflowMode = event.detail?.run_status === 'running' || hasRunningAgent
      ? 'active'
      : event.detail?.run_status === 'idle' || event.detail?.run_status === 'completed'
        ? 'idle'
        : 'unknown';
  }
  for (const state of states) {
    if (statusById.has(state.id)) statusById.set(state.id, state.status);
  }
  if (reducedMotion.matches && workflowMode === 'active') {
    agentMotion.forEach((motion, id) => {
      const person = personGroups.get(id);
      if (person) person.position.copy(motion.home);
      motion.phase = 'home';
      motion.target.copy(motion.home);
    });
  }
  selectedStatus.textContent = currentStatusLabel(selectedId);
  renderFrame(0);
});

function chooseBreakTarget(motion, index) {
  const lounges = getBreakPositions(mobileLayout);
  const loungeIndex = (index + Math.floor(Math.random() * (lounges.length - 1)) + 1) % lounges.length;
  motion.loungeIndex = loungeIndex;
  const lounge = lounges[loungeIndex];
  const angle = (index * 2.4 + sceneTime) % (Math.PI * 2);
  const radius = 0.55 + ((index + 1) % 3) * 0.18;
  motion.target.set(
    THREE.MathUtils.clamp(lounge.x + Math.cos(angle) * radius, mobileLayout ? -2.45 : -6.4, mobileLayout ? 2.45 : 6.4),
    0,
    THREE.MathUtils.clamp(lounge.z + Math.sin(angle) * radius, mobileLayout ? -4.65 : -5.55, mobileLayout ? 4.65 : 5.55),
  );
  motion.phase = 'walking-to-break';
}

function updateAgentMotion(delta) {
  for (const [index, agentData] of AGENTS.entries()) {
    const person = personGroups.get(agentData.id);
    const motion = agentMotion.get(agentData.id);
    const agentStatus = statusById.get(agentData.id);
    const shouldReturn = workflowMode === 'active';
    const walkingSpeed = shouldReturn ? 3.4 : mobileLayout ? 0.82 : 1.15;
    if (shouldReturn) {
      motion.target.copy(motion.home);
      motion.phase = person.position.distanceTo(motion.home) > 0.05 ? 'returning' : 'home';
    } else if (workflowMode === 'idle' && !reducedMotion.matches) {
      if (motion.phase === 'home') {
        motion.pauseRemaining -= delta;
        if (motion.pauseRemaining <= 0) chooseBreakTarget(motion, index);
      } else if (motion.phase === 'at-break') {
        motion.pauseRemaining -= delta;
        if (motion.pauseRemaining <= 0) chooseBreakTarget(motion, index);
      }
    } else {
      motion.target.copy(motion.home);
      motion.phase = person.position.distanceTo(motion.home) > 0.05 ? 'returning' : 'home';
    }

    if (reducedMotion.matches) {
      if (workflowMode === 'active' || workflowMode === 'unknown') person.position.copy(motion.home);
      else if (workflowMode === 'idle') {
        const lounges = getBreakPositions(mobileLayout);
        const lounge = lounges[index % lounges.length];
        const side = index % 2 === 0 ? -1 : 1;
        motion.target.set(lounge.x + side * 0.72, 0, lounge.z + (index % 3 - 1) * 0.16);
        motion.loungeIndex = index % lounges.length;
        person.position.copy(motion.target);
        person.rotation.y = motion.homeAngle;
        motion.phase = 'at-break';
      } else {
        person.position.copy(motion.home);
        motion.phase = 'home';
      }
      const reducedMotionCard = cards.find((item) => item.dataset.agent === agentData.id);
      if (reducedMotionCard && reducedMotionCard.dataset.motion !== motion.phase) {
        reducedMotionCard.dataset.motion = motion.phase;
      }
      continue;
    }

    const offsetX = motion.target.x - person.position.x;
    const offsetZ = motion.target.z - person.position.z;
    const distance = Math.hypot(offsetX, offsetZ);
    if (distance > 0.035) {
      const step = Math.min(distance, walkingSpeed * delta);
      person.position.x += (offsetX / distance) * step;
      person.position.z += (offsetZ / distance) * step;
      person.rotation.y = Math.atan2(offsetX, offsetZ);
      if (motion.phase === 'home' || motion.phase === 'at-break') {
        motion.phase = shouldReturn ? 'returning' : 'walking-to-break';
      }
    } else if (motion.phase === 'walking-to-break') {
      motion.phase = 'at-break';
      motion.pauseRemaining = 3.5 + ((index * 7) % 5) * 1.1;
    } else if (motion.phase === 'returning') {
      motion.phase = 'home';
      person.rotation.y = motion.homeAngle;
    }

    const card = cards.find((item) => item.dataset.agent === agentData.id);
    if (card && card.dataset.motion !== motion.phase) card.dataset.motion = motion.phase;

    if (motion.phase === 'home') {
      person.position.y = agentStatus === 'running'
        ? 0.045 + Math.sin(sceneTime * 4 + index) * 0.05
        : Math.sin(sceneTime * 0.65 + index) * 0.018;
    } else if (motion.phase === 'at-break') {
      person.position.y = 0.012 + Math.sin(sceneTime * 1.4 + index) * 0.012;
      person.rotation.y = motion.homeAngle + Math.sin(sceneTime * 0.35 + index) * 0.035;
    } else {
      person.position.y = Math.abs(Math.sin(sceneTime * 7 + index)) * 0.045;
    }
  }
}

function renderFrame(delta) {
  sceneTime += delta;
  canvas.dataset.workflowMode = workflowMode;
  if (!reducedMotion.matches) {
    core.rotation.y += delta * 0.7;
    gate.rotation.y += delta * 0.24;
    updateAgentMotion(delta);
    for (const item of packetMeshes) {
      const active = statusById.get(item.agentId) === 'running';
      const t = active ? (sceneTime * 0.3 + item.phase) % 1 : 0.22 + item.phase * 0.08;
      item.packet.position.copy(item.curve.getPointAt(t));
      item.packet.position.y += 0.08;
      item.packet.visible = active;
    }
  } else {
    updateAgentMotion(delta);
    packetMeshes.forEach(({ packet }) => { packet.visible = false; });
  }

  for (const { id, halo } of roleTools) {
    const active = statusById.get(id) === 'running';
    const selected = id === selectedId;
    halo.material.opacity = active ? 0.86 : selected ? 0.72 : 0.4;
    halo.scale.setScalar(active && !reducedMotion.matches ? 1 + Math.sin(sceneTime * 4) * 0.055 : selected ? 1.05 : 1);
    halo.material.emissive = halo.material.emissive || new THREE.Color(0x000000);
    halo.material.emissive.setHex(active ? 0x4ca88f : selected ? 0x315f51 : 0x000000);
  }
  for (const { line, agentId } of stationLinks) {
    const state = statusById.get(agentId);
    line.material.opacity = state === 'running' ? 0.82 : agentId === selectedId ? 0.58 : 0.28;
    line.material.color.setHex(state === 'running' ? 0x347f70 : state === 'completed' ? 0x719c78 : 0x82a596);
  }
  renderer.render(scene, camera);
}

function startRenderLoop() {
  if (frameHandle) window.cancelAnimationFrame(frameHandle);
  let previousTime = 0;
  const animate = (time) => {
    const delta = Math.min((time - previousTime) / 1000 || 0, 0.05);
    previousTime = time;
    renderFrame(delta);
    if (!reducedMotion.matches) frameHandle = window.requestAnimationFrame(animate);
    else frameHandle = 0;
  };
  frameHandle = window.requestAnimationFrame(animate);
}

function resizeScene() {
  const rect = sceneRoot.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const isMobile = rect.width < 680;
  if (isMobile !== mobileLayout) {
    mobileLayout = isMobile;
    stationLayouts = getPositions(mobileLayout);
    agents.forEach((station, index) => {
      const layout = stationLayouts[index];
      station.position.set(layout.position.x, 0, layout.position.z);
      station.rotation.y = layout.angle;
      const motion = agentMotion.get(AGENTS[index].id);
      const person = personGroups.get(AGENTS[index].id);
      motion.home.set(
        layout.position.x - Math.sin(layout.angle) * 0.38,
        0,
        layout.position.z - Math.cos(layout.angle) * 0.38,
      );
      motion.homeAngle = layout.angle;
      person.position.copy(motion.home);
      person.rotation.y = layout.angle;
      motion.target.copy(motion.home);
      motion.phase = 'home';
    });
    createBreakAreas(mobileLayout);
    createLinks();
  }
  const viewHeight = isMobile ? 12.7 : 10.4;
  const aspect = rect.width / rect.height;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  if (isMobile) {
    camera.position.set(0, 15, 8.2);
    camera.lookAt(0, 0, 0);
  } else {
    camera.position.set(0, 11.6, 14.5);
    camera.lookAt(0, 0, 0);
  }
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
  renderFrame(0);
}

function hitAgent(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(world.children, true);
  for (const hit of hits) {
    let target = hit.object;
    while (target && !target.userData.agentId) target = target.parent;
    if (target?.userData.agentId) {
      selectAgent(target.userData.agentId);
      return;
    }
  }
}

canvas.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY, rotation: world.rotation.y };
  if (!mobileLayout) canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!pointerDown || mobileLayout) return;
  const distance = event.clientX - pointerDown.x;
  if (Math.abs(distance) > 4) world.rotation.y = pointerDown.rotation + distance * 0.004;
});
canvas.addEventListener('pointerup', (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6;
  pointerDown = null;
  if (!moved) hitAgent(event);
});
canvas.addEventListener('pointercancel', () => { pointerDown = null; });
canvas.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    const index = AGENTS.findIndex((agent) => agent.id === selectedId);
    selectAgent(AGENTS[(index + 1) % AGENTS.length].id);
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    const index = AGENTS.findIndex((agent) => agent.id === selectedId);
    selectAgent(AGENTS[(index - 1 + AGENTS.length) % AGENTS.length].id);
  }
});
canvas.tabIndex = 0;
canvas.setAttribute('role', 'application');
canvas.setAttribute('aria-label', '3D agent network. Use the agent buttons below, or arrow keys when focused, to select an engineer.');

const resizeObserver = new ResizeObserver(resizeScene);
resizeObserver.observe(sceneRoot);
window.addEventListener('resize', resizeScene, { passive: true });
reducedMotion.addEventListener('change', startRenderLoop);

resizeScene();
startRenderLoop();
selectAgent(selectedId);
window.agentWorldReady = true;
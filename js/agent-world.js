import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const AGENTS = [
  { id: 'role-scout', name: 'Mira Patel', role: 'Role Scout', color: 0x2d776f, skin: 0xc88967, hair: 0x30272a, tool: 0xe0ad55 },
  { id: 'fit-analyst', name: 'Arjun Rao', role: 'Fit Analyst', color: 0x3d6b98, skin: 0xd7a37a, hair: 0x3c312c, tool: 0xe1a954 },
  { id: 'resume-tailor', name: 'Leena Das', role: 'Resume Tailor', color: 0xa75b42, skin: 0xb87958, hair: 0x32292b, tool: 0xd6bd61 },
  { id: 'application-writer', name: 'Kabir Shah', role: 'Application Writer', color: 0x677f42, skin: 0xe2b48c, hair: 0x49362d, tool: 0xd88e50 },
  { id: 'application-reviewer', name: 'Nisha Menon', role: 'Application Reviewer', color: 0x906341, skin: 0xc68365, hair: 0x29282a, tool: 0xd8bf6a },
  { id: 'application-coordinator', name: 'Dev Malhotra', role: 'Application Coordinator', color: 0x337989, skin: 0xd29b76, hair: 0x382b28, tool: 0xe0ad55 },
  { id: 'feedback-analyst', name: 'Tara Iyer', role: 'Feedback Analyst', color: 0x796284, skin: 0xc58a6a, hair: 0x33282d, tool: 0xd6bd61 },
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
  person.position.set(0, 0, -0.38);
  node.add(person);
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

let mobileLayout = window.matchMedia('(max-width: 680px)').matches;
const agents = getPositions(mobileLayout).map((layout, index) => createEngineer(AGENTS[index], layout.position, layout.angle));

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
  }
  for (const state of states) {
    if (statusById.has(state.id)) statusById.set(state.id, state.status);
  }
  selectedStatus.textContent = currentStatusLabel(selectedId);
  renderFrame(0);
});

function renderFrame(delta) {
  sceneTime += delta;
  if (!reducedMotion.matches) {
    core.rotation.y += delta * 0.7;
    gate.rotation.y += delta * 0.24;
    for (const [index, agent] of agents.entries()) {
      const active = statusById.get(AGENTS[index].id) === 'running';
      agent.position.y = active ? 0.045 + Math.sin(sceneTime * 4 + index) * 0.05 : Math.sin(sceneTime * 0.65 + index) * 0.018;
    }
    for (const item of packetMeshes) {
      const active = statusById.get(item.agentId) === 'running';
      const t = active ? (sceneTime * 0.3 + item.phase) % 1 : 0.22 + item.phase * 0.08;
      item.packet.position.copy(item.curve.getPointAt(t));
      item.packet.position.y += 0.08;
      item.packet.visible = active;
    }
  } else {
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
    const layouts = getPositions(mobileLayout);
    agents.forEach((agent, index) => {
      agent.position.set(layouts[index].position.x, 0, layouts[index].position.z);
      agent.rotation.y = layouts[index].angle;
    });
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
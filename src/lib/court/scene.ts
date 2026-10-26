import * as THREE from 'three';
import { advanceWorld, createWorld } from './physics';
import { basketballTexture, contactTexture, hardwoodTexture } from './textures';
import { createShots, hoverPosition, pilePosition, RIM, shotPosition, type Shot } from './shots';
import type { UploadBridge } from './uploadBridge';

type Tier = 'high' | 'medium' | 'low';
type SceneOptions = {
  seed: number;
  perf: boolean;
  onFailure: (error: unknown) => void;
};

// ── Renderer lifetime and resource ownership ──
export function mountCourt(
  host: HTMLDivElement,
  bridge: UploadBridge,
  options: SceneOptions,
) {
  let renderer: THREE.WebGLRenderer | undefined;
  const scene = new THREE.Scene();
  const textures: THREE.Texture[] = [];
  let frame = 0,
    disposed = false,
    unsubscribe = () => {},
    observer: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined,
    monitor: ReturnType<typeof setInterval> | undefined;
  const cleanups: (() => void)[] = [];
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    unsubscribe();
    observer?.disconnect();
    resizeObserver?.disconnect();
    if (monitor) clearInterval(monitor);
    for (const cleanup of cleanups) cleanup();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (object instanceof THREE.Light) object.dispose();
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments
      ) {
        geometries.add(object.geometry);
        if (Array.isArray(object.material))
          for (const material of object.material) materials.add(material);
        else materials.add(object.material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const map of textures) map.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
  }
  function fail(error: unknown) {
    dispose();
    options.onFailure(error);
  }

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    const webgl = renderer;
    host.appendChild(webgl.domElement);
    webgl.domElement.setAttribute('aria-hidden', 'true');
    webgl.outputColorSpace = THREE.SRGBColorSpace;
    webgl.toneMapping = THREE.ACESFilmicToneMapping;
    webgl.toneMappingExposure = 1;
    const css = getComputedStyle(host),
      token = (name: string) => css.getPropertyValue(`--color-${name}`).trim();
    const orange = token('ball'),
      rimColor = token('rim'),
      alert = token('alert');
    const normalRim = new THREE.Color(rimColor),
      errorRim = new THREE.Color(alert),
      unlit = new THREE.Color(0x000000);
    // Every camera ray intersects hardwood; no paper horizon or global scrim.
    scene.fog = null;
    const camera = new THREE.PerspectiveCamera(49, 1, 0.1, 110);
    let mobile = window.innerWidth < 640;
    let lastDpr = window.devicePixelRatio;
    let tier: Tier = mobile ? 'medium' : 'high';
    const world = createWorld(40, options.seed, false);
    world.bounds = { minX: -60, maxX: 60, minZ: -95, maxZ: 35 };
    let shots: ReturnType<typeof createShots>;
    const point = { x: 0, y: 0, z: 0 },
      dummy = new THREE.Object3D();
    let time = 0,
      last = 0,
      intersecting = true,
      hidden = document.hidden,
      frameCount = 0;
    let measurementStart = performance.now();

    // ── Warm key, cool fill and optional real shadows ──
    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x977043, 1.6));
    const key = new THREE.DirectionalLight(0xffebcc, 2.4);
    key.position.set(-9, 16, 9);
    key.target.position.set(0, 0, -2);
    scene.add(key, key.target);
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -18;
    key.shadow.camera.right = 18;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -18;
    key.shadow.normalBias = 0.025;
    const fill = new THREE.DirectionalLight(0xb8d2ff, 0.8);
    fill.position.set(12, 6, -8);
    scene.add(fill);

    // ── Procedural hardwood, pebbled basketballs and instancing ──
    const ballMap = basketballTexture(orange);
    textures.push(ballMap);
    const woodMap = hardwoodTexture();
    textures.push(woodMap);
    const shadowMap = contactTexture();
    textures.push(shadowMap);
    const ballMaterial = new THREE.MeshStandardMaterial({
      map: ballMap,
      bumpMap: ballMap,
      bumpScale: 0.025,
      roughness: 0.83,
    });
    let sphere = new THREE.SphereGeometry(1, 48, 32);
    const loose = new THREE.InstancedMesh(sphere, ballMaterial, 40);
    const uploaded = new THREE.InstancedMesh(sphere, ballMaterial, 85);
    loose.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    uploaded.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    loose.frustumCulled = false;
    uploaded.frustumCulled = false;
    scene.add(loose, uploaded);
    const floorMaterial = new THREE.MeshPhysicalMaterial({
      map: woodMap,
      roughness: 0.65,
      clearcoat: 0.18,
      clearcoatRoughness: 0.6,
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(31, 36),
      floorMaterial,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = 1;
    floor.receiveShadow = true;
    scene.add(floor);
    const surroundMap = hardwoodTexture(false); textures.push(surroundMap);
    surroundMap.wrapS = surroundMap.wrapT = THREE.RepeatWrapping;
    surroundMap.repeat.set(8, 8);
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ map: surroundMap, roughness: 0.8 }));
    surround.rotation.x = -Math.PI / 2; surround.position.y = -0.015;
    surround.receiveShadow = true; scene.add(surround);

    // ── Contact shadows: a single batch with per-instance height fading ──
    const shadowGeometry = new THREE.PlaneGeometry(1, 1);
    const opacity = new THREE.InstancedBufferAttribute(
      new Float32Array(113),
      1,
    ).setUsage(THREE.DynamicDrawUsage);
    shadowGeometry.setAttribute('instanceOpacity', opacity);
    const shadowMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { map: { value: shadowMap } },
      vertexShader:
        'attribute float instanceOpacity; varying vec2 vUv; varying float vOpacity; void main(){vUv=uv;vOpacity=instanceOpacity;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}',
      fragmentShader:
        'uniform sampler2D map; varying vec2 vUv; varying float vOpacity; void main(){gl_FragColor=vec4(0.03,0.025,0.02,texture2D(map,vUv).a*vOpacity);}',
    });
    const shadows = new THREE.InstancedMesh(
      shadowGeometry,
      shadowMaterial,
      113,
    );
    shadows.frustumCulled = false;
    shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(shadows);
    let shadowCount = 0;
    function shadow(x: number, y: number, z: number, radius: number) {
      dummy.position.set(x, 0.012, z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      const scale = radius * (2.8 + Math.max(0, y - radius) * 0.35);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      shadows.setMatrixAt(shadowCount, dummy.matrix);
      opacity.setX(shadowCount, 0.8 / (1 + Math.max(0, y - radius) * 0.8));
      shadowCount++;
    }

    // ── Backboard, rim and reactive shader net ──
    const white = new THREE.MeshStandardMaterial({
      color: 0xf6f8f4,
      roughness: 0.55,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x384139,
      metalness: 0.5,
      roughness: 0.5,
    });
    function box(
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      material: THREE.Material,
    ) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      return mesh;
    }
    box(0.14, 5.2, 0.14, RIM.x, 2.6, RIM.z - 1.2, metal);
    box(0.12, 0.12, 1.25, RIM.x, 4.1, RIM.z - 0.6, metal);
    box(
      2.3,
      1.45,
      0.08,
      RIM.x,
      4.1,
      RIM.z - 0.55,
      new THREE.MeshStandardMaterial({
        color: 0xf4f8ff,
        transparent: true,
        opacity: 0.72,
        roughness: 0.2,
      }),
    );
    box(2.4, 0.07, 0.12, RIM.x, 4.85, RIM.z - 0.55, white);
    box(2.4, 0.07, 0.12, RIM.x, 3.36, RIM.z - 0.55, white);
    box(0.07, 1.5, 0.12, RIM.x - 1.17, 4.1, RIM.z - 0.55, white);
    box(0.07, 1.5, 0.12, RIM.x + 1.17, 4.1, RIM.z - 0.55, white);
    box(0.85, 0.045, 0.02, RIM.x, 4.27, RIM.z - 0.49, metal);
    box(0.85, 0.045, 0.02, RIM.x, 3.7, RIM.z - 0.49, metal);
    box(0.045, 0.6, 0.02, RIM.x - 0.425, 3.99, RIM.z - 0.49, metal);
    box(0.045, 0.6, 0.02, RIM.x + 0.425, 3.99, RIM.z - 0.49, metal);
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: rimColor,
      metalness: 0.25,
      roughness: 0.4,
    });
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.045, 10, 48),
      rimMaterial,
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(RIM.x, RIM.y, RIM.z);
    scene.add(rim);
    const netVertices: number[] = [];
    for (let ring = 0; ring < 4; ring++)
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2,
          nextAngle = ((i + 1) / 12) * Math.PI * 2;
        const radius = 0.48 - ring * 0.055,
          nextRadius = radius - 0.055;
        netVertices.push(
          Math.cos(angle) * radius,
          -ring * 0.2,
          Math.sin(angle) * radius,
          Math.cos(nextAngle) * radius,
          -ring * 0.2,
          Math.sin(nextAngle) * radius,
          Math.cos(angle) * radius,
          -ring * 0.2,
          Math.sin(angle) * radius,
          Math.cos(angle + 0.12) * nextRadius,
          -(ring + 1) * 0.2,
          Math.sin(angle + 0.12) * nextRadius,
        );
      }
    const netGeometry = new THREE.BufferGeometry();
    netGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(netVertices, 3),
    );
    const netMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, sway: { value: 0 } },
      vertexShader:
        'uniform float time; uniform float sway; void main(){vec3 p=position;float d=clamp(-p.y/0.8,0.0,1.0);p.x+=sin(time*12.0+d*3.0)*sway*d;p.y+=abs(sin(time*9.0))*sway*d*0.35;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}',
      fragmentShader: 'void main(){gl_FragColor=vec4(0.37,0.4,0.36,1.0);}',
    });
    const net = new THREE.LineSegments(netGeometry, netMaterial);
    net.position.copy(rim.position);
    scene.add(net);
    const basketBox = new THREE.BoxGeometry(3.5, 1.7, 1.8);
    const basket = new THREE.LineSegments(new THREE.EdgesGeometry(basketBox),
      new THREE.LineBasicMaterial({ color: 0x5b655f, transparent: true, opacity: 0.6 }));
    basketBox.dispose(); basket.position.set(RIM.x, 0.85, RIM.z); scene.add(basket);

    // ── One short completion burst, with preallocated particle parameters ──
    const confetti = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.08, 0.045),
      new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        transparent: true,
      }),
      40,
    );
    const velocities = new Float32Array(120),
      random = world.random;
    const confettiColors = [
      new THREE.Color(orange),
      new THREE.Color(token('cobalt')),
      new THREE.Color(token('ink')),
    ];
    for (let i = 0; i < 40; i++) {
      velocities[i * 3] = (random() - 0.5) * 6;
      velocities[i * 3 + 1] = 2 + random() * 4;
      velocities[i * 3 + 2] = (random() - 0.5) * 5;
      confetti.setColorAt(i, confettiColors[i % 3]);
    }
    confetti.count = 0;
    confetti.frustumCulled = false;
    scene.add(confetti);

    const hoverRings = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1, .035, 6, 32),
      new THREE.MeshBasicMaterial({ color: token('cobalt'), transparent: true, opacity: .55, depthWrite: false }),
      5,
    );
    hoverRings.count = 0; hoverRings.frustumCulled = false;
    hoverRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(hoverRings);

    // ── Quality adaptation: measurements never step back up ──
    const readout = options.perf ? document.createElement('output') : null;
    if (readout) {
      readout.className = 'court-perf';
      readout.setAttribute('aria-label', 'Court rendering performance');
      document.body.appendChild(readout);
      cleanups.push(() => readout.remove());
    }
    function quality(next: Tier) {
      tier = next;
      // Quality changes geometry and DPR, never the upload's ball inventory.
      webgl.setPixelRatio(
        Math.min(
          window.devicePixelRatio || 1,
          tier === 'high' ? 2 : tier === 'medium' ? 1.5 : 1,
        ),
      );
      webgl.shadowMap.enabled = tier === 'high';
      webgl.shadowMap.type = THREE.PCFShadowMap;
      key.castShadow = tier === 'high';
      loose.castShadow = tier === 'high';
      uploaded.castShadow = tier === 'high';
      floorMaterial.clearcoat = tier === 'high' ? 0.18 : 0;
      // Geometry changes occur only on tier transitions, never in the hot drawing path.
      const nextSphere = new THREE.SphereGeometry(
        1,
        tier === 'high' ? 48 : tier === 'medium' ? 32 : 24,
        tier === 'high' ? 32 : tier === 'medium' ? 20 : 16,
      );
      loose.geometry = nextSphere;
      uploaded.geometry = nextSphere;
      sphere.dispose();
      sphere = nextSphere;
    }
    function resize() {
      if (disposed) return;
      const width = host.clientWidth,
        height = host.clientHeight;
      mobile = width < 640;
      if (mobile && tier === 'high') quality('medium');
      camera.aspect = width / Math.max(1, height);
      const narrow = width < 640;
      camera.position.set(0, narrow ? 22 : 17, narrow ? 26 : 22);
      camera.fov = narrow ? 62 : 46;
      camera.lookAt(narrow ? 2 : -2, -1, narrow ? -1 : 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      webgl.setPixelRatio(
        Math.min(
          window.devicePixelRatio || 1,
          tier === 'high' ? 2 : tier === 'medium' ? 1.5 : 1,
        ),
      );
      webgl.setSize(width, height, false);
    }
    quality(tier);
    resize();

    // ── Reuse the floor inventory for scoring; avoid measured UI rectangles ──
    const projected = new THREE.Vector3(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Raycaster(), screen = new THREE.Vector2(), candidate = new THREE.Vector3();
    let avoid: DOMRect[] = [];
    const floorOwners: (Shot | undefined)[] = [];
    const measureAvoid = () => {
      if (typeof document.querySelectorAll === 'function') {
        avoid = Array.from(document.querySelectorAll<HTMLElement>('[data-court-avoid]'), element => element.getBoundingClientRect())
          .filter(rect => rect.right > 0 && rect.left < host.clientWidth && rect.bottom > 0 && rect.top < host.clientHeight);
      }
    };
    function obscured(x: number, y: number, z: number) {
      projected.set(x, y, z).project(camera);
      const sx = (projected.x + 1) * host.clientWidth / 2, sy = (1 - projected.y) * host.clientHeight / 2;
      for (const rect of avoid) if (sx > rect.left - 22 && sx < rect.right + 22 && sy > rect.top - 22 && sy < rect.bottom + 22) return true;
      return Math.abs(projected.x) > 0.95 || Math.abs(projected.y) > 0.95;
    }
    function rebuildFloor(count: number, drop: boolean) {
      floorOwners.length = 0;
      measureAvoid(); world.count = count; world.accumulator = 0;
      for (let i = 0; i < world.balls.length; i++) {
        const b = world.balls[i]; b.enabled = i < count;
        if (!b.enabled) continue;
        b.radius = (drop ? 0.32 : 0.24) + world.random() * (drop ? 0.25 : 0.12);
        b.mass = b.radius ** 3 * 8;
        for (let attempt = 0; attempt < 160; attempt++) {
          screen.set((0.07 + world.random() * 0.86) * 2 - 1, 1 - (0.34 + world.random() * 0.5) * 2);
          ray.setFromCamera(screen, camera); ray.ray.intersectPlane(ground, candidate);
          let overlap = false;
          for (let j = 0; j < i; j++) {
            const other = world.balls[j];
            if (Math.hypot(other.x - candidate.x, other.z - candidate.z) < other.radius + b.radius + 0.12) overlap = true;
          }
          if (!overlap && !obscured(candidate.x, b.radius, candidate.z)) break;
        }
        b.x = b.px = candidate.x; b.z = b.pz = candidate.z;
        b.y = b.py = b.radius + (drop ? 0.8 + world.random() * 2.5 : 0);
        b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
        b.ax = b.pax = world.random() * 6; b.ay = b.pay = world.random() * 6; b.az = b.paz = world.random() * 6;
        b.sleeping = !drop; b.rest = 0;
      }
    }
    function reserveFloorBall(shot: Shot) {
      measureAvoid();
      let selected = shot.floorIndex;
      if (selected >= 0 && !world.balls[selected].enabled) throw new Error('Floor ball is already reserved');
      if (selected < 0) {
      for (let i = 0; i < world.count; i++) {
        const b = world.balls[i]; if (!b.enabled || floorOwners[i]) continue;
        if (selected === -1) selected = i;
        if (!obscured(b.x, b.y, b.z)) { selected = i; break; }
      }
      }
      if (selected < 0) throw new Error('Upload ball inventory exhausted');
      const b = world.balls[selected]; b.enabled = false;
      floorOwners[selected] = shot; shot.floorIndex = selected;
      shot.originX = b.x; shot.originY = b.y; shot.originZ = b.z;
      shot.fromX = b.x; shot.fromY = b.y; shot.fromZ = b.z; shot.radius = b.radius;
      shot.rotationX = b.ax; shot.rotationY = b.ay; shot.rotationZ = b.az;
    }
    function restoreFloorBall(shot: Shot) {
      if (shot.floorIndex < 0) return;
      const b = world.balls[shot.floorIndex]; b.enabled = true;
      b.x = b.px = shot.originX; b.z = b.pz = shot.originZ;
      b.y = b.py = b.radius + .3;
      b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
      b.sleeping = false; b.rest = 0;
    }
    shots = createShots(bridge, { rebuild: rebuildFloor, reserve: reserveFloorBall, restore: restoreFloorBall });
    window.addEventListener('resize', measureAvoid); cleanups.push(() => window.removeEventListener('resize', measureAvoid));
    let avoidTimer: ReturnType<typeof setTimeout> | undefined;
    if (typeof MutationObserver !== 'undefined' && document.body) {
      const changes = new MutationObserver(() => {
        if (!avoidTimer) avoidTimer = setTimeout(() => { avoidTimer = undefined; measureAvoid(); }, 100);
      });
      changes.observe(document.body, { childList: true, subtree: true });
      cleanups.push(() => { changes.disconnect(); if (avoidTimer) clearTimeout(avoidTimer); });
    }
    monitor = setInterval(() => {
      if (hidden || !intersecting || disposed) {
        measurementStart = performance.now();
        frameCount = 0;
        return;
      }
      const now = performance.now(),
        fps = (frameCount * 1000) / Math.max(1, now - measurementStart);
      if (lastDpr !== window.devicePixelRatio) {
        lastDpr = window.devicePixelRatio;
        resize();
      }
      if (readout)
        readout.textContent = `${Math.round(fps)} FPS · ${tier} · ${world.count} balls`;
      if (fps < 28 && tier !== 'low') {
        quality('low');
        resize();
      } else if (fps < 48 && tier === 'high') {
        quality('medium');
        resize();
      }
      measurementStart = now;
      frameCount = 0;
    }, 2000);

    // ── Imperative upload subscription: failures cannot reach the uploader ──
    unsubscribe = bridge.subscribe((event) => {
      try {
        shots.accept(event);
        if (hidden || !intersecting) shots.fastForward();
      } catch (error) {
        fail(error);
      }
    });

    // ── Animation loop: reuse transforms, vectors, arrays and instance buffers ──
    function draw(now: number) {
      frame = 0;
      if (disposed || hidden || !intersecting) return;
      try {
        const dt = last ? Math.min((now - last) / 1000, 5 / 120) : 0;
        last = now;
        const stopped = shots.state.phase === 'error';
        if (!stopped) time += dt;
        frameCount++;
        // Returned hover balls must finish their small drop even on a final error.
        // Confirmed scoring arcs still freeze until Retry, as before.
        const alpha = advanceWorld(world, dt);
        if (!stopped) shots.update(dt);
        shadowCount = 0;
        let floorCount = 0;
        for (let i = 0; i < world.count; i++) {
          const b = world.balls[i];
          if (!b.enabled) continue;
          const x = b.px + (b.x - b.px) * alpha,
            y = b.py + (b.y - b.py) * alpha,
            z = b.pz + (b.z - b.pz) * alpha;
          dummy.position.set(x, y, z);
          dummy.rotation.set(
            b.pax + (b.ax - b.pax) * alpha,
            b.pay + (b.ay - b.pay) * alpha,
            b.paz + (b.az - b.paz) * alpha,
          );
          dummy.scale.setScalar(b.radius);
          dummy.updateMatrix();
          loose.setMatrixAt(floorCount++, dummy.matrix);
          shadow(x, y, z, b.radius);
        }
        loose.count = floorCount;
        loose.instanceMatrix.needsUpdate = true;
        let uploadCount = 0, ringCount = 0;
        let hasActiveShot = false;
        for (let i = 0; i < shots.slots.length; i++)
          if (shots.slots[i].active || shots.slots[i].hovering) hasActiveShot = true;
        const hanging =
          shots.state.phase === 'finishing' &&
          shots.state.saved > 0 &&
          shots.state.queued === 0 &&
          !hasActiveShot;
        let held = -1;
        if (hanging) for (let i = 0; i < shots.slots.length; i++) if (shots.slots[i].scored) held = i;
        const celebration = shots.state.celebration;
        const hop =
          celebration >= 0 && celebration < 0.45
            ? Math.sin((celebration / 0.45) * Math.PI) * 0.25
            : 0;
        for (let i = 0; i < shots.slots.length; i++) {
          const slot = shots.slots[i]; if (!slot.scored || i === held) continue;
          pilePosition(slot.ordinal, point);
          point.y += hop;
          dummy.position.set(point.x, point.y, point.z);
          dummy.rotation.set(i * 0.5, i * 1.2, 0);
          dummy.scale.setScalar(slot.radius);
          dummy.updateMatrix();
          uploaded.setMatrixAt(uploadCount++, dummy.matrix);
          shadow(point.x, point.y, point.z, slot.radius);
        }
        for (let i = 0; i < shots.slots.length; i++) {
          const slot = shots.slots[i];
          if (!slot.active && !slot.queued && !slot.hovering) continue;
          if (slot.hovering) hoverPosition(slot, point);
          else if (slot.active) shotPosition(slot, point);
          else { point.x = slot.fromX; point.y = slot.fromY; point.z = slot.fromZ; }
          dummy.position.set(point.x, point.y, point.z);
          dummy.rotation.set(slot.rotationX + slot.age * 6, slot.rotationY + slot.age * 3, slot.rotationZ);
          dummy.scale.setScalar(slot.radius);
          dummy.updateMatrix();
          uploaded.setMatrixAt(uploadCount++, dummy.matrix);
          shadow(point.x, point.y, point.z, slot.radius);
          if (slot.hovering) {
            dummy.position.set(point.x, point.y - slot.radius - .06, point.z);
            dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.setScalar(slot.radius * 1.5);
            dummy.updateMatrix(); hoverRings.setMatrixAt(ringCount++, dummy.matrix);
          }
        }
        hoverRings.count = ringCount; hoverRings.instanceMatrix.needsUpdate = true;
        if (hanging && held >= 0) {
          dummy.position.set(RIM.x, RIM.y + 0.6, RIM.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(shots.slots[held].radius);
          dummy.updateMatrix();
          uploaded.setMatrixAt(uploadCount++, dummy.matrix);
          shadow(RIM.x, RIM.y + 0.6, RIM.z, 0.27);
        }
        uploaded.count = uploadCount;
        uploaded.instanceMatrix.needsUpdate = true;
        shadows.count = shadowCount;
        shadows.instanceMatrix.needsUpdate = true;
        opacity.needsUpdate = true;
        rimMaterial.color.copy(stopped ? errorRim : normalRim);
        rimMaterial.emissive.copy(
          shots.state.phase === 'finishing' ? normalRim : unlit,
        );
        rimMaterial.emissiveIntensity =
          shots.state.phase === 'finishing'
            ? 0.12 + Math.sin(time * 3) * 0.06
            : 0;
        netMaterial.uniforms.time.value = time;
        netMaterial.uniforms.sway.value =
          shots.state.netImpulse +
          (shots.state.phase === 'finishing' ? 0.045 : 0);
        confetti.count = celebration >= 0 && celebration < 1.2 ? 40 : 0;
        for (let i = 0; i < confetti.count; i++) {
          dummy.position.set(
            RIM.x + velocities[i * 3] * celebration,
            RIM.y +
              velocities[i * 3 + 1] * celebration -
              4.9 * celebration * celebration,
            RIM.z + velocities[i * 3 + 2] * celebration,
          );
          dummy.rotation.set(i + celebration * 5, celebration * 3, i * 1.7);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          confetti.setMatrixAt(i, dummy.matrix);
        }
        confetti.material.opacity = Math.max(0, 1 - celebration / 1.2);
        confetti.instanceMatrix.needsUpdate = true;
        webgl.render(scene, camera);
        frame = requestAnimationFrame(draw);
      } catch (error) {
        fail(error);
      }
    }

    // ── Visibility, DPR, context loss and teardown ──
    function visibility() {
      hidden = document.hidden;
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      world.accumulator = 0;
      shots.fastForward();
      measurementStart = performance.now();
      frameCount = 0;
      if (!hidden && intersecting && !disposed)
        frame = requestAnimationFrame(draw);
    }
    observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      visibility();
    });
    observer.observe(host);
    resizeObserver = new ResizeObserver(() => {
      try {
        resize();
      } catch (error) {
        fail(error);
      }
    });
    resizeObserver.observe(host);
    const contextLost = (event: Event) => {
      event.preventDefault();
      fail(new Error('WebGL context lost'));
    };
    webgl.domElement.addEventListener('webglcontextlost', contextLost);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility);
    const dprChange = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    dprChange.addEventListener('change', resize);
    cleanups.push(() => {
      webgl.domElement.removeEventListener('webglcontextlost', contextLost);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      dprChange.removeEventListener('change', resize);
    });
    if (!hidden) frame = requestAnimationFrame(draw);
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}

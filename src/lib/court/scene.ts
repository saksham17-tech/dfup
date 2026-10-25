import * as THREE from 'three';
import { advanceWorld, createWorld } from './physics';
import { basketballTexture, contactTexture, hardwoodTexture } from './textures';
import { createShots, pilePosition, RIM, shotPosition } from './shots';
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
      alert = token('alert'),
      paper = token('paper');
    const normalRim = new THREE.Color(rimColor),
      errorRim = new THREE.Color(alert),
      unlit = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(paper, 25, 65);
    const camera = new THREE.PerspectiveCamera(49, 1, 0.1, 110);
    let mobile = window.innerWidth < 640;
    let lastDpr = window.devicePixelRatio;
    let tier: Tier = mobile ? 'medium' : 'high';
    const world = createWorld(28, options.seed),
      shots = createShots(bridge);
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
    const loose = new THREE.InstancedMesh(sphere, ballMaterial, 28);
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
      world.count = mobile
        ? 12
        : tier === 'high'
          ? 28
          : tier === 'medium'
            ? 22
            : 12;
      loose.count = world.count;
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
      world.count = mobile
        ? 12
        : tier === 'high'
          ? 28
          : tier === 'medium'
            ? 22
            : 12;
      loose.count = world.count;
      camera.aspect = width / Math.max(1, height);
      const narrow = width < 640;
      camera.position.set(narrow ? 0 : 0.5, narrow ? 15 : 12, narrow ? 29 : 23);
      camera.fov = narrow ? 62 : 49;
      camera.lookAt(narrow ? 2 : 0, 0.7, -3);
      camera.updateProjectionMatrix();
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
        const alpha = stopped ? 1 : advanceWorld(world, dt);
        if (!stopped) shots.update(dt);
        shadowCount = 0;
        for (let i = 0; i < world.count; i++) {
          const b = world.balls[i];
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
          loose.setMatrixAt(i, dummy.matrix);
          shadow(x, y, z, b.radius);
        }
        loose.instanceMatrix.needsUpdate = true;
        let uploadCount = 0;
        const total = bridge.snapshot().total;
        const groupSize = Math.max(1, Math.ceil(total / 64));
        let hasActiveShot = false;
        for (let i = 0; i < shots.slots.length; i++)
          if (shots.slots[i].active) hasActiveShot = true;
        const hanging =
          shots.state.phase === 'finishing' &&
          shots.state.saved > 0 &&
          shots.state.queued === 0 &&
          !hasActiveShot;
        const pileCount = Math.min(
          hanging ? 63 : 64,
          Math.ceil(
            Math.max(0, shots.state.settled - (hanging ? 1 : 0)) / groupSize,
          ),
        );
        const celebration = shots.state.celebration;
        const hop =
          celebration >= 0 && celebration < 0.45
            ? Math.sin((celebration / 0.45) * Math.PI) * 0.25
            : 0;
        for (let i = 0; i < pileCount; i++) {
          pilePosition(i, point);
          point.y += hop;
          dummy.position.set(point.x, point.y, point.z);
          dummy.rotation.set(i * 0.5, i * 1.2, 0);
          dummy.scale.setScalar(0.25);
          dummy.updateMatrix();
          uploaded.setMatrixAt(uploadCount++, dummy.matrix);
          shadow(point.x, point.y, point.z, 0.25);
        }
        for (let i = 0; i < shots.slots.length; i++) {
          const slot = shots.slots[i];
          if (!slot.active) continue;
          shotPosition(slot, point);
          dummy.position.set(point.x, point.y, point.z);
          dummy.rotation.set(slot.age * 6, slot.age * 3, 0);
          dummy.scale.setScalar(0.27);
          dummy.updateMatrix();
          uploaded.setMatrixAt(uploadCount++, dummy.matrix);
          shadow(point.x, point.y, point.z, 0.27);
        }
        if (hanging) {
          dummy.position.set(RIM.x, RIM.y + 0.6, RIM.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(0.27);
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

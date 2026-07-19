import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';
import { FinishName, ModelData } from '../types';
import { computeSmoothNormals } from '../utils/stlLoader';

export interface RegionRender {
  id: number;
  displayColor: string;
  finish: FinishName;
  visible: boolean;
}

interface ThreeSceneProps {
  modelData: ModelData | null;
  /** region id per triangle (file order); null until segmentation arrives */
  triRegion: Int32Array | null;
  regions: RegionRender[];
  selectedRegion: number | null;
  backgroundColor: number;
  onPickRegion: (regionId: number | null) => void;
}

export interface ThreeSceneHandle {
  captureScreenshot: () => string | null;
}

const FINISH_PROPS: Record<FinishName, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.85, metalness: 0.0 },
  satin: { roughness: 0.55, metalness: 0.05 },
  gloss: { roughness: 0.22, metalness: 0.08 },
  metallic: { roughness: 0.35, metalness: 1.0 },
};

const HOVER_EMISSIVE = new THREE.Color(0x2a2a2a);
const SELECT_EMISSIVE = new THREE.Color(0x304a66);
const BLACK = new THREE.Color(0x000000);

const ThreeScene = forwardRef<ThreeSceneHandle, ThreeSceneProps>(
  (
    { modelData, triRegion, regions, selectedRegion, backgroundColor, onPickRegion },
    ref
  ) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const meshRef = useRef<THREE.Mesh | null>(null);
    // triangle order after grouping-sort; sortedTris[drawnFace] = file triangle
    const sortedTrisRef = useRef<Uint32Array | null>(null);
    const triRegionRef = useRef<Int32Array | null>(null);
    const regionOrdinalRef = useRef<Map<number, number>>(new Map());
    const hoverRegionRef = useRef<number | null>(null);
    const raycaster = useRef(new THREE.Raycaster());
    const onPickRef = useRef(onPickRegion);
    onPickRef.current = onPickRegion;

    useImperativeHandle(ref, () => ({
      captureScreenshot: () => {
        const r = rendererRef.current;
        const s = sceneRef.current;
        const c = cameraRef.current;
        if (!r || !s || !c) return null;
        r.render(s, c);
        return r.domElement.toDataURL('image/png');
      },
    }));

    // ---- scene bootstrap (once) ----
    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(
        45,
        mount.clientWidth / mount.clientHeight,
        0.1,
        2000
      );
      camera.position.set(14, 14, 22);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      // updateStyle=false + 100% CSS size: if setSize wrote pixel widths to
      // the canvas style, the grid column would grow to fit it, the resize
      // observer would fire, and the layout would inflate forever
      renderer.setSize(mount.clientWidth, mount.clientHeight, false);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      mount.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // image-based lighting so metallic finishes actually read as metal
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.position.set(6, 12, 8);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xdfeaff, 0.5);
      rim.position.set(-8, 5, -7);
      scene.add(rim);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 6, 0);
      controlsRef.current = controls;

      // test/debug instrumentation, only with ?debug in the URL
      const debug: any = { renderer, scene, camera, frames: 0 };
      if (new URLSearchParams(window.location.search).has('debug')) {
        (window as any).__mp = debug;
        // find canvas-fraction coordinates where a region is visible and
        // clickable (verified by raycast), for driving tests
        debug.regionProbe = (regionId: number) => {
          const mesh = meshRef.current;
          const tr = triRegionRef.current;
          const sorted = sortedTrisRef.current;
          if (!mesh || !tr || !sorted) return null;
          const pos = mesh.geometry.attributes.position;
          const v = new THREE.Vector3();
          for (let s = 0; s < sorted.length; s += 7) {
            const t = sorted[s];
            if (tr[t] !== regionId) continue;
            v.fromBufferAttribute(pos, t * 3)
              .add(v.clone().fromBufferAttribute(pos, t * 3 + 1))
              .add(v.clone().fromBufferAttribute(pos, t * 3 + 2))
              .multiplyScalar(1 / 3);
            mesh.localToWorld(v);
            const ndc = v.clone().project(camera);
            if (Math.abs(ndc.x) > 0.95 || Math.abs(ndc.y) > 0.95) continue;
            raycaster.current.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
            const hits = raycaster.current.intersectObject(mesh, false);
            if (!hits.length || hits[0].faceIndex == null) continue;
            if (tr[sorted[hits[0].faceIndex]] === regionId) {
              return { fx: (ndc.x + 1) / 2, fy: (1 - ndc.y) / 2 };
            }
          }
          return null;
        };
      }

      let raf = 0;
      const animate = () => {
        raf = requestAnimationFrame(animate);
        try {
          controls.update();
          renderer.render(scene, camera);
          debug.frames++;
        } catch (err) {
          debug.lastError = String(err);
          throw err;
        }
      };
      animate();

      const onResize = () => {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight, false);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(mount);

      // --- picking: click (not drag) selects a region, hover highlights ---
      const canvas = renderer.domElement;
      let downX = 0;
      let downY = 0;

      const pick = (ev: PointerEvent): number | null => {
        const mesh = meshRef.current;
        const tr = triRegionRef.current;
        const sorted = sortedTrisRef.current;
        if (!mesh || !tr) return null;
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.current.setFromCamera(ndc, camera);
        const hits = raycaster.current.intersectObject(mesh, false);
        for (const hit of hits) {
          if (hit.faceIndex == null) continue;
          const tri = sorted ? sorted[hit.faceIndex] : hit.faceIndex;
          const region = tr[tri];
          // ignore hits on hidden regions so you can click through them
          const ord = regionOrdinalRef.current.get(region);
          const mats = mesh.material as THREE.Material[];
          if (ord != null && Array.isArray(mats) && mats[ord] && !mats[ord].visible) {
            continue;
          }
          return region;
        }
        return null;
      };

      const onPointerDown = (ev: PointerEvent) => {
        downX = ev.clientX;
        downY = ev.clientY;
      };
      const onPointerUp = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 5) return;
        onPickRef.current(pick(ev));
      };

      let hoverPending = false;
      const onPointerMove = (ev: PointerEvent) => {
        const tr = triRegionRef.current;
        if (!tr || tr.length > 400_000 || hoverPending) return;
        hoverPending = true;
        requestAnimationFrame(() => {
          hoverPending = false;
          hoverRegionRef.current = pick(ev);
          syncMaterialHighlights();
        });
      };
      const onPointerLeave = () => {
        hoverRegionRef.current = null;
        syncMaterialHighlights();
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerleave', onPointerLeave);

      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        controls.dispose();
        disposeMesh();
        pmrem.dispose();
        renderer.dispose();
        if (renderer.domElement.parentElement === mount) {
          mount.removeChild(renderer.domElement);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.background = new THREE.Color(backgroundColor);
      }
    }, [backgroundColor]);

    const disposeMesh = () => {
      const mesh = meshRef.current;
      if (!mesh) return;
      sceneRef.current?.remove(mesh);
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => m.dispose());
      meshRef.current = null;
    };

    // ---- (re)build geometry when a model arrives ----
    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene || !modelData) return;
      disposeMesh();

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(modelData.positions, 3)
      );
      geometry.setAttribute(
        'normal',
        new THREE.BufferAttribute(computeSmoothNormals(modelData.positions), 3)
      );

      const material = new THREE.MeshStandardMaterial({
        color: 0xb9b9b9,
        roughness: 0.8,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geometry, [material]);
      geometry.addGroup(0, modelData.triCount * 3, 0);

      // STL is Z-up; scene is Y-up.  Center, scale to a fixed height,
      // stand on the ground plane.
      mesh.rotation.x = -Math.PI / 2;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const scale = 14 / Math.max(size.x, size.y, size.z);
      mesh.scale.setScalar(scale);
      mesh.updateMatrixWorld(true);
      box.setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      mesh.position.sub(center);
      mesh.position.y -= box.min.y - center.y; // feet at y=0
      mesh.updateMatrixWorld(true);

      scene.add(mesh);
      meshRef.current = mesh;
      sortedTrisRef.current = null;
      triRegionRef.current = null;

      const controls = controlsRef.current;
      const camera = cameraRef.current;
      if (controls && camera) {
        box.setFromObject(mesh);
        const c = box.getCenter(new THREE.Vector3());
        controls.target.copy(c);
        const span = box.getSize(new THREE.Vector3()).length();
        camera.position.set(c.x + span * 0.8, c.y + span * 0.45, c.z + span * 0.9);
        camera.near = span / 100;
        camera.far = span * 20;
        camera.updateProjectionMatrix();
      }
    }, [modelData]);

    // ---- regroup triangles by region whenever the cut changes ----
    useEffect(() => {
      const mesh = meshRef.current;
      if (!mesh || !modelData) return;
      triRegionRef.current = triRegion;

      if (!triRegion || regions.length === 0) return;

      const ordinal = new Map<number, number>();
      regions.forEach((r, i) => ordinal.set(r.id, i));
      regionOrdinalRef.current = ordinal;

      const triCount = modelData.triCount;
      const counts = new Int32Array(regions.length);
      for (let t = 0; t < triCount; t++) {
        const o = ordinal.get(triRegion[t]);
        if (o != null) counts[o]++;
      }
      const offsets = new Int32Array(regions.length);
      for (let i = 1; i < regions.length; i++) {
        offsets[i] = offsets[i - 1] + counts[i - 1];
      }
      const starts = offsets.slice();
      const sorted = new Uint32Array(triCount);
      for (let t = 0; t < triCount; t++) {
        const o = ordinal.get(triRegion[t]);
        if (o != null) sorted[offsets[o]++] = t;
      }
      sortedTrisRef.current = sorted;

      const index = new Uint32Array(triCount * 3);
      for (let s = 0; s < triCount; s++) {
        const t = sorted[s];
        index[s * 3] = t * 3;
        index[s * 3 + 1] = t * 3 + 1;
        index[s * 3 + 2] = t * 3 + 2;
      }
      mesh.geometry.setIndex(new THREE.BufferAttribute(index, 1));
      mesh.geometry.clearGroups();

      const oldMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      oldMats.forEach((m) => m.dispose());
      const materials: THREE.MeshStandardMaterial[] = [];
      regions.forEach((region, i) => {
        mesh.geometry.addGroup(starts[i] * 3, counts[i] * 3, i);
        materials.push(
          new THREE.MeshStandardMaterial({
            color: region.displayColor,
            envMapIntensity: 0.9,
            ...FINISH_PROPS[region.finish],
          })
        );
      });
      mesh.material = materials;
      syncMaterialProps();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [triRegion, modelData]);

    // keep material look in sync with region styles without rebuilding
    const regionsRef = useRef(regions);
    regionsRef.current = regions;
    const selectedRef = useRef(selectedRegion);
    selectedRef.current = selectedRegion;

    const syncMaterialProps = () => {
      const mesh = meshRef.current;
      if (!mesh || !Array.isArray(mesh.material)) return;
      const mats = mesh.material as THREE.MeshStandardMaterial[];
      const regs = regionsRef.current;
      if (mats.length !== regs.length) return;
      regs.forEach((region, i) => {
        const m = mats[i];
        m.color.set(region.displayColor);
        const f = FINISH_PROPS[region.finish];
        m.roughness = f.roughness;
        m.metalness = f.metalness;
        m.visible = region.visible;
      });
      syncMaterialHighlights();
    };

    const syncMaterialHighlights = () => {
      const mesh = meshRef.current;
      if (!mesh || !Array.isArray(mesh.material)) return;
      const mats = mesh.material as THREE.MeshStandardMaterial[];
      const regs = regionsRef.current;
      if (mats.length !== regs.length) return;
      regs.forEach((region, i) => {
        const emissive =
          region.id === selectedRef.current
            ? SELECT_EMISSIVE
            : region.id === hoverRegionRef.current
            ? HOVER_EMISSIVE
            : BLACK;
        mats[i].emissive.copy(emissive);
      });
    };

    useEffect(syncMaterialProps, [regions, selectedRegion]);

    return (
      <div
        ref={mountRef}
        style={{
          width: '100%',
          height: '640px',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid #d1d5db',
          cursor: 'pointer',
        }}
      />
    );
  }
);

export default ThreeScene;

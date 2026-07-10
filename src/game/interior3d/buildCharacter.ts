import * as THREE from "three";

/**
 * A procedurally built low-poly humanoid NPC.
 *
 * The character is assembled from primitive geometries (boxes + capsules)
 * grouped under a single THREE.Group so it can be positioned/rotated as one.
 * `update(t)` drives a subtle idle "breathing" float plus an occasional,
 * slow, unsettling head turn.
 */
export interface CharacterHandle {
  /** Root group. Position / rotate this to place the NPC. */
  group: THREE.Group;
  /** Advance the idle animation. `t` is elapsed time in seconds. */
  update: (t: number) => void;
  /** Free all geometries + materials owned by this character. */
  dispose: () => void;
}

export interface CharacterOptions {
  /** Clothing / body colour. */
  bodyColor?: THREE.ColorRepresentation;
  /** Skin colour for head + hands. */
  skinColor?: THREE.ColorRepresentation;
  /** If true, small emissive eyes are added (extra horror). */
  glowingEyes?: boolean;
}

export function buildCharacter(options: CharacterOptions = {}): CharacterHandle {
  const {
    bodyColor = 0x1d2126,
    skinColor = 0xb9a894,
    glowingEyes = true,
  } = options;

  const group = new THREE.Group();
  group.name = "npc";

  // Track disposables so we can clean up deterministically.
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const bodyMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.85,
      metalness: 0.05,
    })
  );
  const skinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: skinColor,
      roughness: 0.7,
      metalness: 0.0,
    })
  );

  const addMesh = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(track(geo), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  };

  // Legs (capsules).
  addMesh(new THREE.CapsuleGeometry(0.1, 0.55, 4, 8), bodyMat, -0.13, 0.42, 0);
  addMesh(new THREE.CapsuleGeometry(0.1, 0.55, 4, 8), bodyMat, 0.13, 0.42, 0);

  // Torso (box).
  addMesh(new THREE.BoxGeometry(0.52, 0.72, 0.28), bodyMat, 0, 1.12, 0);

  // Arms (capsules), slightly angled outward.
  const armL = addMesh(
    new THREE.CapsuleGeometry(0.08, 0.5, 4, 8),
    bodyMat,
    -0.34,
    1.12,
    0
  );
  const armR = addMesh(
    new THREE.CapsuleGeometry(0.08, 0.5, 4, 8),
    bodyMat,
    0.34,
    1.12,
    0
  );
  armL.rotation.z = 0.12;
  armR.rotation.z = -0.12;

  // Hands (small skin boxes at the end of the arms).
  addMesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), skinMat, -0.36, 0.83, 0);
  addMesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), skinMat, 0.36, 0.83, 0);

  // Neck.
  addMesh(new THREE.CapsuleGeometry(0.06, 0.08, 4, 6), skinMat, 0, 1.55, 0);

  // Head is parented to its own pivot so it can turn independently.
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.68, 0);
  group.add(headPivot);

  const headGeo = track(new THREE.BoxGeometry(0.28, 0.32, 0.26));
  const head = new THREE.Mesh(headGeo, skinMat);
  head.castShadow = true;
  headPivot.add(head);

  if (glowingEyes) {
    const eyeMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: new THREE.Color(0xff4030),
        emissiveIntensity: 1.4,
        roughness: 0.4,
      })
    );
    const eyeGeo = track(new THREE.BoxGeometry(0.05, 0.05, 0.02));
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.07, 0.02, 0.14);
    eyeR.position.set(0.07, 0.02, 0.14);
    headPivot.add(eyeL);
    headPivot.add(eyeR);
  }

  const baseY = group.position.y;

  const update = (t: number): void => {
    // Breathing: subtle vertical float + torso scale would be nicer but
    // keep it cheap — just bob the whole group a few millimetres.
    group.position.y = baseY + Math.sin(t * 1.6) * 0.02;

    // Slow, creepy head turn: mostly still, occasionally swivels.
    const turn = Math.sin(t * 0.35) * 0.9;
    headPivot.rotation.y = turn;
    // Tiny tilt keeps it from feeling mechanical.
    headPivot.rotation.z = Math.sin(t * 0.7) * 0.04;
  };

  const dispose = (): void => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    group.clear();
  };

  return { group, update, dispose };
}

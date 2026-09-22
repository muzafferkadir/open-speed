import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Room shell in local space: the door wall sits at +Z, the camera looks at it from -Z. */
const HALF_WIDTH = 8;
const BACK = -14;
const DOOR_Z = 7;
const HEIGHT = 4.4;
/** Height of the turntable deck; the car stands on it. */
export const PLATFORM_TOP = .125;

type Prop = {
 file: string;
 /** Target width in metres; the GLB is scaled uniformly to match. */
 width: number;
 pos: [number, number, number];
 rotY?: number;
 /** Place the model's base on pos.y instead of its centre. */
 stand?: boolean;
};

const PROPS: Prop[] = [
 { file: 'platform', width: 5, pos: [0, 0, 0], stand: true },
 { file: 'door-panel', width: 9, pos: [0, 0, DOOR_Z - .06], stand: true },
 // Flanking the door on the same wall, front faces the camera.
 { file: 'tire-shelf', width: 3, pos: [6.2, 0, DOOR_Z - .5], stand: true },
 // Under the posters, against the right-hand wall.
 { file: 'workbench', width: 3.4, pos: [HALF_WIDTH - .4, 0, 3.4], rotY: -Math.PI / 2, stand: true },
 { file: 'posters', width: 2.8, pos: [HALF_WIDTH - .2, 2.9, 1.5], rotY: -Math.PI / 2 },
];

/** Concrete showroom around the car: procedural shell, GLB props, practical lights. */
export class GarageRoom {
 readonly group = new THREE.Group();
 /** Platform and car live here; the menu spins this, never the camera. */
 readonly turntable = new THREE.Group();
 private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

 constructor() {
  this.group.add(this.turntable);
  this.buildShell();
  this.buildLights();
 }

 /** Loads the prop GLBs; failures are ignored so the menu still renders. */
 async load(anisotropy = 8) {
  await Promise.all(PROPS.map(async prop => {
   const gltf = await this.loader.loadAsync(`/garage/${prop.file}.glb`).catch(() => null);
   if (!gltf) return;
   const model = gltf.scene;
   const box = new THREE.Box3().setFromObject(model);
   const size = box.getSize(new THREE.Vector3());
   const scale = prop.width / size.x;
   model.scale.setScalar(scale);
   model.rotation.y = prop.rotY ?? 0;
   const centre = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
   const lift = prop.stand ? -box.min.y * scale : -centre.y;
   model.position.set(prop.pos[0] - centre.x, prop.pos[1] + lift, prop.pos[2] - centre.z);
   model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = true;
    // Grazing-angle floor textures alias badly without anisotropic filtering.
    // The turntable is the darkest surface in the concept art; the raw bake is far too bright.
    if (prop.file === 'platform') {
     node.material.color.multiplyScalar(.7);
     // The baked brushed-metal detail aliases into moiré at this grazing angle.
     node.material.roughness = .55;
     node.material.normalMap = null;
    }
    for (const map of [node.material.map, node.material.roughnessMap, node.material.normalMap]) {
     if (!map) continue;
     map.anisotropy = anisotropy;
     map.needsUpdate = true;
    }
   });
   (prop.file === 'platform' ? this.turntable : this.group).add(model);
  }));
 }

 private buildShell() {
  const depth = DOOR_Z - BACK;
  const midZ = (DOOR_Z + BACK) / 2;
  const concrete = new THREE.MeshStandardMaterial({ color: '#34363a', roughness: .12, metalness: .45 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_WIDTH * 2, depth), concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = midZ;
  floor.receiveShadow = true;
  this.group.add(floor);

  const wall = new THREE.MeshStandardMaterial({ color: '#4a4744', roughness: .95, metalness: .04, side: THREE.BackSide });
  // Sunk below the floor plane so the two surfaces never z-fight.
  const shell = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2, HEIGHT + 1, depth), wall);
  shell.position.set(0, HEIGHT / 2 - .5, midZ);
  this.group.add(shell);
 }

 private buildLights() {
  this.group.add(new THREE.HemisphereLight('#8fa6c0', '#100d0a', .45));

  // Two warm tubes running along the room, symmetric over the turntable.
  for (const x of [-3.2, 3.2]) {
   const tube = new THREE.Mesh(
    new THREE.BoxGeometry(.12, .08, 7),
    new THREE.MeshBasicMaterial({ color: '#ffeccb', toneMapped: false }));
   tube.position.set(x, HEIGHT - .2, .5);
   this.group.add(tube);
   // Several weak lamps along the tube spread evenly; one strong lamp reads as a bare bulb.
   for (const z of [-2.4, .5, 3.4]) {
    const lamp = new THREE.PointLight('#ffd9a8', 9, 16, 2);
    lamp.position.set(x, HEIGHT - .45, z);
    this.group.add(lamp);
   }
  }

  // Frontal fill from the camera side. A point light this close burns a specular
  // hotspot into the bonnet; a directional has no falloff and stays even.
  const fill = new THREE.DirectionalLight('#dfe7f2', .28);
  fill.position.set(-5.2, 3.4, -9);
  this.group.add(fill);

  // A single shadow caster from above keeps the contact shadow crisp.
  const key = new THREE.SpotLight('#ffeeda', 34, 20, .9, .8, 2);
  key.position.set(-1.2, HEIGHT - .3, .8);
  key.target.position.set(0, .4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -.0008;
  this.group.add(key, key.target);

  // Practicals: blue batten on the right wall, red ember low at the back.
  const neon = new THREE.Mesh(
   new THREE.BoxGeometry(.08, 2.6, .1),
   new THREE.MeshBasicMaterial({ color: '#8fe2ff', toneMapped: false }));
  neon.position.set(HALF_WIDTH - .12, 2.4, -1);
  this.group.add(neon);
  // Kept close to the wall so it washes the concrete instead of the car.
  const neonLight = new THREE.PointLight('#49b8ff', 34, 9, 2);
  neonLight.position.set(HALF_WIDTH - .4, 2.4, -1);
  this.group.add(neonLight);

  const ember = new THREE.PointLight('#ff4a2a', 10, 8, 2);
  ember.position.set(HALF_WIDTH - 1.2, .6, -3.5);
  this.group.add(ember);
 }
}

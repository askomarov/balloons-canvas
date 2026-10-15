import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Inspector } from "three/addons/inspector/Inspector.js";
import { uniforms } from "../inflatable/uniforms.js";
import { createPointerInput } from "../inflatable/pointer.js";
import { createBalloonSound } from "../inflatable/balloonSound.js";
import { InflatableText3D } from "./InflatableText3D.js";
import { createStage } from "./stage.js";
import { createDebug3D } from "./debug3d.js";
import { waitForFont } from "../inflatable/waitFont.js";
import { createLoadProgress } from "../inflatable/loadProgress.js";
import { wordFromQuery } from "./wordFromQuery.js";

const canvas = document.querySelector("canvas.threejs");
const loader = document.querySelector("#loader");
const startButton = loader.querySelector(".loader__start");
const prompt = document.querySelector(".prompt");
const load = createLoadProgress(loader);
const scene = new THREE.Scene();

const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

/**
 * Camera
 * Pixel space world: 1 unit = 1 css px on the z = 0 plane (in the default view)
 */
const fov = 24;
const camera = new THREE.PerspectiveCamera(
  fov,
  sizes.width / sizes.height,
  10,
  10000,
);
scene.add(camera);

const homeDistance = () =>
  sizes.height / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2));

const updateCamera = () => {
  const distance = homeDistance();
  camera.aspect = sizes.width / sizes.height;
  camera.near = distance * 0.05;
  camera.far = distance * 6;
  camera.updateProjectionMatrix();
};

const resetCamera = () => {
  camera.position.set(0, 0, homeDistance());
  controls.target.set(0, 0, 0);
  controls.update();
};

/**
 * Controls: toggled from the inspector, while on they own the pointer and the letters only get hover
 */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enabled = false;
controls.autoRotateSpeed = 1.2;
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

updateCamera();
resetCamera();

/**
 * Renderer
 */
const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: false,
  alpha: true,
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

/**
 * Scene
 */
// Sniglet ships 400/800 only — 700 made Safari bake system-font SDF
const font = { style: "", weight: "800", family: "Sniglet" };
let stage;
let inflatable;
let balloonSound;

await load.run([
  {
    weight: 4,
    label: "GPU",
    task: () => renderer.init(),
  },
  {
    weight: 2,
    label: "Font",
    task: () => waitForFont(font),
  },
  {
    weight: 3,
    label: "Letters",
    task: async () => {
      stage = createStage({ renderer, scene });
      stage.setViewport(sizes.width, sizes.height);
      inflatable = new InflatableText3D({
        renderer,
        scene,
        font,
        onLayout: stage.update,
      });
      inflatable.setViewport(sizes.width, sizes.height);
      inflatable.build(wordFromQuery());
      await renderer.compileAsync(scene, camera);
    },
  },
  {
    weight: 1,
    label: "Audio",
    task: () => {
      balloonSound = createBalloonSound({
        url: `${import.meta.env.BASE_URL}sounds/balloon.mp3`,
      });
      return balloonSound.ready;
    },
  },
]);

renderer.inspector = new Inspector();
renderer.inspector.init(); // renderer.init() already ran — mount DOM manually

const playPressSound = async ({ x, y }) => {
  if (!balloonSound.settings.enabled) return;
  if (await inflatable.hitTest(x, y)) balloonSound.play();
};

createDebug3D({
  renderer,
  inflatable,
  stage,
  controls,
  resetCamera,
  sound: balloonSound,
});

// Stay deflated under the loader. Intro clock starts on Start.
uniforms.introStart.value = 1e6;

const openScene = () => {
  if (loader.hidden) return;

  loader.hidden = true;
  inflatable.replayIntro();
  prompt.classList.add("is-on");
};

startButton.addEventListener("click", () => {
  balloonSound.unlock();
  startButton.disabled = true;
  loader.classList.add("is-leaving");

  const duration = Number.parseFloat(
    getComputedStyle(loader).transitionDuration,
  );
  if (!duration) openScene();
});

loader.addEventListener("transitionend", (event) => {
  if (event.target !== loader || event.propertyName !== "opacity") return;
  openScene();
});

load.ready();

/**
 * Resize
 */
window.addEventListener("resize", () => {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  updateCamera();
  stage.setViewport(sizes.width, sizes.height);
  inflatable.setViewport(sizes.width, sizes.height);

  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

/**
 * Pointer: ray against the z = 0 plane, so the letters stay interactive from any camera angle
 */
const raycaster = new THREE.Raycaster();
const letterPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();

const pointerInput = createPointerInput({
  canvas,
  toWorld: (event) => {
    ndc.set(
      (event.clientX / sizes.width) * 2 - 1,
      1 - (event.clientY / sizes.height) * 2,
    );
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(letterPlane, hit)) return null;

    return { x: hit.x, y: hit.y };
  },
  canPress: () => !controls.enabled,
  onPress: playPressSound,
});

/**
 * Animate
 */
const timer = new THREE.Timer();
timer.connect(document);

const tick = () => {
  timer.update();
  const deltaTime = timer.getDelta();

  if (controls.enabled) controls.update(deltaTime);

  pointerInput.update();
  inflatable.update(deltaTime);
  pointerInput.endFrame();

  renderer.render(scene, camera);
};

renderer.setAnimationLoop(tick);

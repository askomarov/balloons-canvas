import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Inspector } from "three/addons/inspector/Inspector.js";
import { InflatableText } from "./inflatable/InflatableText.js";
import { uniforms } from "./inflatable/uniforms.js";
import { createDebug } from "./inflatable/debug.js";
import { createPointerInput } from "./inflatable/pointer.js";
import { createBalloonSound } from "./inflatable/balloonSound.js";

/**
 * Base
 */
// Canvas
const canvas = document.querySelector("canvas.threejs");

// Scene
const scene = new THREE.Scene();

/**
 * Sizes
 */
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

/**
 * Camera
 * Pixel space world: 1 unit = 1 css px on the z = 0 plane
 */
const fov = 24;
const camera = new THREE.PerspectiveCamera(
  fov,
  sizes.width / sizes.height,
  10,
  10000,
);
scene.add(camera);

const updateCamera = () => {
  camera.aspect = sizes.width / sizes.height;
  camera.position.set(
    0,
    0,
    sizes.height / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2)),
  );
  camera.near = camera.position.z * 0.2;
  camera.far = camera.position.z * 3;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
};
updateCamera();

// Controls (debug only, they fight with the letters interaction)
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enabled = false;

/**
 * Renderer
 */
const renderer = new THREE.WebGPURenderer({
  canvas: canvas,
  antialias: true,
  alpha: true,
});
renderer.toneMapping = THREE.NoToneMapping;
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.inspector = new Inspector();
await renderer.init();

/**
 * Inflatable text
 */
const font = { style: "", weight: "700", family: "Sniglet" };
await document.fonts
  .load(`${font.weight} 180px ${font.family}`, "Ballons")
  .catch(() => {});

const inflatable = new InflatableText({ renderer, scene, font });
inflatable.setViewport(sizes.width, sizes.height);
inflatable.build("Ballons");

const balloonSound = createBalloonSound({
  url: `${import.meta.env.BASE_URL}sounds/balloon.mp3`,
});

const playPressSound = async ({ x, y }) => {
  if (!balloonSound.settings.enabled) return;
  if (await inflatable.hitTest(x, y)) balloonSound.play();
};

createDebug({
  renderer,
  inflatable,
  controls,
  updateCamera,
  sound: balloonSound,
});

// Stay deflated under the loader. Intro clock starts on Start.
uniforms.introStart.value = 1e6;

const loader = document.querySelector("#loader");
const startButton = loader.querySelector(".loader__start");
const prompt = document.querySelector(".prompt");

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

loader.classList.add("is-ready");
startButton.disabled = false;

/**
 * Resize
 */
window.addEventListener("resize", () => {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  updateCamera();
  inflatable.setViewport(sizes.width, sizes.height);

  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

/**
 * Pointer
 */
const pointerInput = createPointerInput({
  canvas,
  toWorld: (event) => ({
    x: event.clientX - sizes.width / 2,
    y: sizes.height / 2 - event.clientY,
  }),
  canPress: () => !controls.enabled,
  onPress: playPressSound,
});

/**
 * Animate
 */
const timer = new THREE.Timer();

const tick = () => {
  timer.update();
  const deltaTime = timer.getDelta();

  if (controls.enabled) controls.update();

  pointerInput.update();
  inflatable.update(deltaTime);
  pointerInput.endFrame();

  renderer.render(scene, camera);
};

renderer.setAnimationLoop(tick);

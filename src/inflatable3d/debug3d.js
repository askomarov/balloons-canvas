import {
  addInteractionGui,
  addMotionGui,
  addSoundGui,
  addSpringsGui,
  addStringsGui,
  addTextGui,
} from "../inflatable/debug.js";
import { uniforms as u } from "../inflatable/uniforms.js";
import { materialSettings as m } from "./balloonMesh.js";

export function createDebug3D({
  renderer,
  inflatable,
  stage,
  controls,
  resetCamera,
  sound,
}) {
  const inspector = renderer.inspector;

  addTextGui(inspector, inflatable);
  addSoundGui(inspector, sound);

  /**
   * Balloon
   */
  const balloonGui = inspector.createParameters("Balloon");
  balloonGui.add(u.puff, "value", 0, 2, 0.01).name("puff");
  balloonGui.add(u.creaseStrength, "value", 0, 6, 0.01).name("creaseStrength");
  balloonGui.add(u.seamDarkness, "value", 0, 1, 0.01).name("seamDarkness");
  balloonGui.add(m.seamTint, "value", 0, 1, 0.01).name("seamTint");
  balloonGui.add(u.dentRadius, "value", 0.02, 0.5, 0.001).name("dentRadius");
  balloonGui.add(m.roughness, "value", 0, 1, 0.001).name("roughness");
  balloonGui.add(m.clearcoat, "value", 0, 1, 0.001).name("clearcoat");
  balloonGui
    .add(m.clearcoatRoughness, "value", 0, 1, 0.001)
    .name("clearcoatRoughness");
  balloonGui.add(m.sheen, "value", 0, 1, 0.001).name("sheen");
  balloonGui
    .add(renderer, "toneMappingExposure", 0.2, 3, 0.01)
    .name("exposure");

  addSpringsGui(inspector);
  addInteractionGui(inspector);
  addMotionGui(inspector);

  /**
   * Light & shadow
   */
  const s = stage.settings;
  const lightGui = inspector.createParameters("Light & Shadow").close();
  lightGui.add(s, "lightX", -2, 2, 0.01).onChange(stage.update);
  lightGui.add(s, "lightY", -2, 2, 0.01).onChange(stage.update);
  lightGui.add(s, "lightIntensity", 0, 8, 0.01).onChange(stage.update);
  lightGui.add(s, "environmentIntensity", 0, 3, 0.01).onChange(stage.update);
  lightGui
    .add(s, "wallDepth", 0.05, 2, 0.01)
    .name("wallDepth (× unit)")
    .onChange(stage.update);
  lightGui.add(s, "shadowOpacity", 0, 1, 0.01).onChange(stage.update);
  lightGui.add(s, "shadowRadius", 0, 20, 0.1).onChange(stage.update);
  lightGui
    .add(s, "shadowBias", 0, 20, 0.1)
    .name("shadowBias (px)")
    .onChange(stage.update);
  lightGui
    .add(s, "shadowNormalBias", 0, 20, 0.1)
    .name("shadowNormalBias (px)")
    .onChange(stage.update);

  addStringsGui(inspector, inflatable);
  inspector.hide();

  /**
   * Camera
   */
  const cameraGui = inspector.createParameters("Camera");
  cameraGui.add(controls, "enabled").name("orbitControls");
  cameraGui.add(controls, "autoRotate").name("autoRotate (orbit on)");
  cameraGui.add(controls, "autoRotateSpeed", -10, 10, 0.1);
  cameraGui.add({ resetCamera }, "resetCamera");
}

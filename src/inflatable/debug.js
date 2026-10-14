import { uniforms as u } from "./uniforms.js";

export function createDebug({
  renderer,
  inflatable,
  controls,
  updateCamera,
  sound = null,
}) {
  const inspector = renderer.inspector;

  addTextGui(inspector, inflatable);
  if (sound) addSoundGui(inspector, sound);

  /**
   * Balloon
   */
  const balloonGui = inspector.createParameters("Balloon");
  balloonGui.add(u.puff, "value", 0, 2, 0.01).name("puff");
  balloonGui.add(u.gloss, "value", 0, 2, 0.01).name("gloss");
  balloonGui.add(u.exposure, "value", 0.2, 2, 0.01).name("exposure");
  balloonGui.add(u.creaseStrength, "value", 0, 6, 0.01).name("creaseStrength");
  balloonGui.add(u.seamDarkness, "value", 0, 1, 0.01).name("seamDarkness");
  balloonGui.add(u.dentRadius, "value", 0.02, 0.5, 0.001).name("dentRadius");
  balloonGui.add(u.keyLight, "value", 0, 6, 0.01).name("keyLight");
  balloonGui.add(u.stripLight, "value", 0, 6, 0.01).name("stripLight");
  balloonGui.add(u.topLight, "value", 0, 6, 0.01).name("topLight");

  addSpringsGui(inspector);
  addInteractionGui(inspector);
  addMotionGui(inspector);

  /**
   * Shadow
   */
  const shadowGui = inspector.createParameters("Shadow").close();
  shadowGui.add(u.shadowStrength, "value", 0, 3, 0.01).name("strength");
  shadowGui.add(u.shadowSoftness, "value", 0.1, 4, 0.01).name("softness");
  shadowGui.add(u.shadowOffset.value, "x", -0.2, 0.2, 0.001).name("offsetX");
  shadowGui.add(u.shadowOffset.value, "y", -0.2, 0.2, 0.001).name("offsetY");
  shadowGui.addColor(u.shadowTint, "value").name("tint");

  addStringsGui(inspector, inflatable);
  inspector.hide();
  /**
   * Camera
   */
  const cameraGui = inspector.createParameters("Camera").close();
  const cameraParams = {
    orbitControls: controls.enabled,
    resetCamera: () => {
      controls.target.set(0, 0, 0);
      updateCamera();
    },
  };
  cameraGui
    .add(cameraParams, "orbitControls")
    .onChange((value) => (controls.enabled = value));
  cameraGui.add(cameraParams, "resetCamera");
}

export function addTextGui(inspector, inflatable) {
  const textGui = inspector.createParameters("Text");
  const textParams = {
    text: inflatable.text,
    rebuild: () => inflatable.build(textParams.text),
    replayIntro: () => inflatable.replayIntro(),
  };

  const textEditor = textGui
    .add(textParams, "text")
    .name('text ("|" = new line)');
  textEditor.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") textParams.rebuild();
  });
  textGui.add(textParams, "rebuild");
  textGui.add(textParams, "replayIntro");
  const colorEditor = textGui.addColor(u.color, "value").name("color");
  textGui
    .add(inflatable.settings, "tracking", -0.1, 0.2, 0.001)
    .onChange(() => inflatable.relayout());
  textGui
    .add(inflatable.settings, "maxSize", 0, 600, 1)
    .name("maxSize (0 = fit)")
    .onChange(() => inflatable.relayout());

  return { textGui, colorEditor };
}

export function addSoundGui(inspector, sound) {
  const soundGui = inspector.createParameters("Sound");
  soundGui.add(sound.settings, "enabled").name("sound on press");
  soundGui.add(sound.settings, "volume", 0, 1, 0.01);
  soundGui.add(sound.settings, "pitchVariation", 0, 0.5, 0.01);
  soundGui.add(sound, "play").name("test");

  return soundGui;
}

export function addSpringsGui(inspector) {
  const springsGui = inspector.createParameters("Springs").close();
  springsGui
    .add(u.positionStiffness, "value", 0, 300, 0.1)
    .name("positionStiffness");
  springsGui
    .add(u.positionDamping, "value", 0, 30, 0.01)
    .name("positionDamping");
  springsGui
    .add(u.rotationStiffness, "value", 0, 300, 0.1)
    .name("rotationStiffness");
  springsGui
    .add(u.rotationDamping, "value", 0, 30, 0.01)
    .name("rotationDamping");
  springsGui.add(u.tiltStiffness, "value", 0, 600, 0.1).name("tiltStiffness");
  springsGui.add(u.tiltDamping, "value", 0, 40, 0.01).name("tiltDamping");
  springsGui
    .add(u.inflateStiffness, "value", 0, 600, 0.1)
    .name("inflateStiffness");
  springsGui.add(u.inflateDamping, "value", 0, 40, 0.01).name("inflateDamping");
  springsGui.add(u.dentStiffness, "value", 0, 1000, 0.1).name("dentStiffness");
  springsGui.add(u.dentDamping, "value", 0, 40, 0.01).name("dentDamping");
  springsGui
    .add(u.squashStiffness, "value", 0, 4000, 1)
    .name("squashStiffness");
  springsGui.add(u.squashDamping, "value", 0, 60, 0.01).name("squashDamping");
  springsGui.add(u.pairStiffness, "value", 0, 2000, 1).name("pairStiffness");
  springsGui.add(u.tiltAmount, "value", 0, 1.5, 0.001).name("tiltAmount");

  return springsGui;
}

export function addInteractionGui(inspector) {
  const interactionGui = inspector.createParameters("Interaction");
  interactionGui.add(u.hoverDent, "value", 0, 0.92, 0.001).name("hoverDent");
  interactionGui.add(u.pressDent, "value", 0, 0.92, 0.001).name("pressDent");
  interactionGui
    .add(u.knockStrength, "value", 0, 3, 0.01)
    .name("knockStrength");
  interactionGui
    .add(u.knockSpeed, "value", 50, 3000, 1)
    .name("knockSpeed (px/s)");
  interactionGui.add(u.pumpStrength, "value", 0, 3, 0.01).name("pumpStrength");
  interactionGui.add(u.pullAmount, "value", 0, 1, 0.001).name("pullAmount");

  return interactionGui;
}

export function addMotionGui(inspector) {
  const motionGui = inspector.createParameters("Idle & Intro").close();
  motionGui.add(u.idleAmplitude, "value", 0, 5, 0.01).name("idleAmplitude");
  motionGui.add(u.idleSpeed, "value", 0, 5, 0.01).name("idleSpeed");
  motionGui.add(u.introDuration, "value", 0.05, 8, 0.01).name("introDuration");
  motionGui.add(u.introStagger, "value", 0, 0.5, 0.001).name("introStagger");
  motionGui
    .add(u.introLift, "value", 0, 3, 0.01)
    .name("introLift (× string)");
  motionGui
    .add(u.introLiftDelay, "value", 0, 0.9, 0.01)
    .name("introLiftDelay");

  return motionGui;
}

export function addStringsGui(inspector, inflatable) {
  const stringsGui = inspector.createParameters("Strings").close();
  const stringsParams = { enabled: inflatable.settings.strings };
  stringsGui
    .add(stringsParams, "enabled")
    .onChange((value) => inflatable.setStringsVisible(value));
  stringsGui.add(u.stringLength, "value", 0.1, 3, 0.01).name("length");
  stringsGui.add(u.stringGravity, "value", 0, 5000, 1).name("gravity");
  stringsGui.add(u.stringCurl, "value", 0, 4, 0.01).name("curl");
  stringsGui.add(u.stringTurns, "value", 0, 4, 0.01).name("turns");
  stringsGui.add(u.stringWidth, "value", 0.1, 5, 0.01).name("width");

  return stringsGui;
}

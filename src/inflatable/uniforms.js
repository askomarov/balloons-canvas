import { color, sRGBTransferEOTF, uniform, vec2 } from "three/tsl";

/**
 * Shared uniforms (tweakables + per frame inputs)
 * Spring pairs are [stiffness, damping]
 */
export const uniforms = {
  // Layout / simulation
  viewport: uniform(vec2(1, 1)),
  layoutScale: uniform(1),
  unit: uniform(180),
  cellSize: uniform(1),
  fontSize: uniform(180),
  letterCount: uniform(0, "int"),
  simTime: uniform(0),
  simDeltaTime: uniform(1 / 120),
  frameDeltaTime: uniform(1 / 60),

  // Balloon look
  color: uniform(color("#3d77ff")),
  puff: uniform(0.85),
  gloss: uniform(1),
  creaseStrength: uniform(2.2),
  seamDarkness: uniform(0.45),
  dentRadius: uniform(0.18),
  exposure: uniform(1.05),
  keyLight: uniform(2.6),
  stripLight: uniform(1.35),
  topLight: uniform(0.55),

  // Springs
  positionStiffness: uniform(62),
  positionDamping: uniform(5.8),
  rotationStiffness: uniform(80),
  rotationDamping: uniform(5.5),
  tiltStiffness: uniform(170),
  tiltDamping: uniform(11),
  inflateStiffness: uniform(190),
  inflateDamping: uniform(7.5),
  dentStiffness: uniform(300),
  dentDamping: uniform(10),
  squashStiffness: uniform(1500),
  squashDamping: uniform(12),
  pairStiffness: uniform(520),
  tiltAmount: uniform(0.32),

  // Interaction
  hoverDent: uniform(0.3),
  pressDent: uniform(0.86),
  knockStrength: uniform(1),
  knockSpeed: uniform(520),
  pumpStrength: uniform(1),
  pullAmount: uniform(0.35),

  // Idle
  idleAmplitude: uniform(1),
  idleSpeed: uniform(1),

  // Intro
  introStart: uniform(0),
  introDuration: uniform(3.2),
  introStagger: uniform(0.14),
  introLift: uniform(1),
  introLiftDelay: uniform(0.3),

  // Shadow
  shadowStrength: uniform(1),
  shadowSoftness: uniform(1),
  shadowOffset: uniform(vec2(0.01, -0.035)),
  shadowTint: uniform(color("#241717")),

  // Strings
  stringLength: uniform(1),
  stringGravity: uniform(1500),
  stringCurl: uniform(1),
  stringTurns: uniform(1),
  stringWidth: uniform(1),

  // Cursor (world px, y up)
  cursorPosition: uniform(vec2()),
  cursorPrevious: uniform(vec2()),
  cursorVelocity: uniform(vec2()),
  cursorInside: uniform(0),
  cursorDown: uniform(0),
  cursorIsMouse: uniform(1),
  downPosition: uniform(vec2()),
  pressStart: uniform(0),
  releaseTap: uniform(0),
  releaseFling: uniform(0),
};

// Deep vinyl colour: the picked colour is linearized once more, saturating it the way thin coloured film does
export const balloonColor = sRGBTransferEOTF(uniforms.color);

import { uniforms } from "./uniforms.js";

/**
 * Pointer -> cursor uniforms (world px on the z = 0 plane, y up)
 * toWorld(event) returns { x, y } or null when the pointer misses the plane
 */
export function createPointerInput({
  canvas,
  toWorld,
  canPress = () => true,
  onPress = null,
}) {
  const pointer = {
    x: 0,
    y: 0,
    time: 0,
    downTime: 0,
    moved: 0,
    isDown: false,
    id: null,
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button > 0 || !canPress(event)) return;

    const world = toWorld(event);
    if (!world) return;

    const { x, y } = world;
    pointer.x = x;
    pointer.y = y;
    pointer.isDown = true;
    pointer.id = event.pointerId;
    pointer.downTime = performance.now() / 1000;
    pointer.time = pointer.downTime;
    pointer.moved = 0;

    uniforms.cursorPosition.value.set(x, y);
    uniforms.cursorPrevious.value.set(x, y);
    uniforms.cursorVelocity.value.set(0, 0);
    uniforms.downPosition.value.set(x, y);
    uniforms.cursorDown.value = 1;
    uniforms.cursorInside.value = 1;
    uniforms.cursorIsMouse.value = event.pointerType === "mouse" ? 1 : 0;
    uniforms.pressStart.value = 1;

    canvas.setPointerCapture(event.pointerId);
    onPress?.(world, event);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (pointer.isDown && event.pointerId !== pointer.id) return;

    const world = toWorld(event);
    if (!world) return;

    const { x, y } = world;
    const now = performance.now() / 1000;
    const elapsed = Math.max(now - pointer.time, 0.004);
    const velocity = uniforms.cursorVelocity.value;
    const wasInside = uniforms.cursorInside.value > 0.5;

    // Smoothed px/s velocity
    const targetVelocityX = wasInside ? (x - pointer.x) / elapsed : 0;
    const targetVelocityY = wasInside ? (y - pointer.y) / elapsed : 0;
    velocity.x += (targetVelocityX - velocity.x) * 0.6;
    velocity.y += (targetVelocityY - velocity.y) * 0.6;

    pointer.moved += Math.abs(x - pointer.x) + Math.abs(y - pointer.y);
    pointer.x = x;
    pointer.y = y;
    pointer.time = now;

    if (!wasInside) uniforms.cursorPrevious.value.set(x, y);

    uniforms.cursorPosition.value.set(x, y);
    uniforms.cursorInside.value = 1;
    uniforms.cursorIsMouse.value = event.pointerType === "mouse" ? 1 : 0;
  });

  const release = (event, isCancel = false) => {
    if (!pointer.isDown || event.pointerId !== pointer.id) return;

    const isTap =
      !isCancel &&
      performance.now() / 1000 - pointer.downTime < 0.3 &&
      pointer.moved < 12;

    if (isTap) uniforms.releaseTap.value = 1;
    else uniforms.releaseFling.value = 1;

    pointer.isDown = false;
    pointer.id = null;
    uniforms.cursorDown.value = 0;

    if (event.pointerType !== "mouse") uniforms.cursorInside.value = 0;

    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
  };

  canvas.addEventListener("pointerup", (event) => release(event));
  canvas.addEventListener("pointercancel", (event) => release(event, true));
  canvas.addEventListener("pointerleave", () => {
    if (pointer.isDown) return;

    uniforms.cursorInside.value = 0;
    uniforms.cursorVelocity.value.set(0, 0);
  });
  canvas.addEventListener("dragstart", (event) => event.preventDefault());

  return {
    // Before the simulation: velocity decays when the cursor stops
    update() {
      const velocity = uniforms.cursorVelocity.value;
      if (performance.now() / 1000 - pointer.time > 0.05)
        velocity.multiplyScalar(0.8);
    },

    // After the simulation: one frame events
    endFrame() {
      uniforms.cursorPrevious.value.copy(uniforms.cursorPosition.value);
      uniforms.pressStart.value = 0;
      uniforms.releaseTap.value = 0;
      uniforms.releaseFling.value = 0;
    },
  };
}

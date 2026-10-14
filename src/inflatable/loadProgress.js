/**
 * Weighted step progress for the full-screen loader.
 * Updates after each real await completes — not a fake timer.
 */
export function createLoadProgress(root) {
  const fill = root.querySelector(".loader__fill");
  const track = root.querySelector(".loader__track");
  const label = root.querySelector(".loader__label");
  const startButton = root.querySelector(".loader__start");

  const paint = (ratio) => {
    const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
    fill.style.width = `${pct}%`;
    track.setAttribute("aria-valuenow", String(pct));
    label.textContent = `${pct}%`;
  };

  paint(0);

  return {
    async run(steps) {
      const total = steps.reduce((sum, step) => sum + (step.weight ?? 1), 0);
      let done = 0;

      for (const step of steps) {
        if (step.label) label.dataset.step = step.label;
        await step.task();
        done += step.weight ?? 1;
        paint(done / total);
      }
    },

    ready() {
      paint(1);
      root.classList.add("is-ready");
      startButton.disabled = false;
    },
  };
}

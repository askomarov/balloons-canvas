/**
 * Sniglet on Google Fonts is only 400 / 800.
 * Safari will happily resolve fonts.load("700 …") against a fallback face,
 * then canvas measures/rasterizes with the system font → wrong SDF forever.
 */
export async function waitForFont(font, sample = "Balloons", size = 180) {
  const spec = `${font.style} ${font.weight} ${size}px ${font.family}`.trim();

  await document.fonts.ready;
  await document.fonts.load(spec, sample);

  // Safari: first load() can resolve before the face is canvas-usable
  for (let i = 0; i < 8 && !document.fonts.check(spec, sample); i++) {
    await new Promise((r) => requestAnimationFrame(r));
    await document.fonts.load(spec, sample);
  }

  if (!document.fonts.check(spec, sample)) {
    throw new Error(`Font not available: ${spec}`);
  }
}

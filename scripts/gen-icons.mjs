import sharp from "sharp";
import { mkdirSync } from "node:fs";

function svg(size, maskable = false) {
  const cell = Math.round(size * 0.09);
  const gap = Math.round(size * 0.035);
  const pad = maskable ? Math.round(size * 0.2) : Math.round(size * 0.22);
  const total = 5 * cell + 4 * gap;
  let x = Math.round((size - total) / 2);
  const y = Math.round(size / 2 - cell / 2);
  let cells = "";
  for (let i = 0; i < 5; i++) {
    const lit = i === 3;
    cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}"
      fill="${lit ? "#14b8a6" : "#0a0a0a"}"
      stroke="${lit ? "#14b8a6" : "rgba(20,184,166,0.7)"}" stroke-width="${Math.max(1, Math.round(size * 0.006))}"
      ${lit ? 'style="filter: drop-shadow(0 0 ' + Math.round(size * 0.03) + 'px #14b8a6)"' : ""} />`;
    x += cell + gap;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="#0b0f19"/>
    <rect x="${pad}" y="${pad}" width="${size - 2 * pad}" height="${size - 2 * pad}" fill="none"
      stroke="rgba(20,184,166,0.35)" stroke-width="${Math.max(1, Math.round(size * 0.008))}"/>
    ${cells}
  </svg>`;
}

mkdirSync("client/public", { recursive: true });
for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-512-maskable.png", 512, true],
]) {
  await sharp(Buffer.from(svg(size, maskable)))
    .png()
    .toFile(`client/public/${name}`);
  console.log(`wrote client/public/${name}`);
}

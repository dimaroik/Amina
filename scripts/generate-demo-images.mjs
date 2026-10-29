// Generates minimalist garment illustrations used by the demo catalog (client/public/demo).
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../client/public/demo');
fs.mkdirSync(out, { recursive: true });

const shapes = {
  dress: 'M240 120 Q300 150 360 120 L380 135 L372 230 Q366 270 380 300 L470 690 Q300 730 130 690 L220 300 Q234 270 228 230 L220 135 Z',
  blouse: 'M245 150 Q300 185 355 150 L440 190 L500 360 L452 380 L410 280 L418 560 Q300 590 182 560 L190 280 L148 380 L100 360 L160 190 Z',
  trousers: 'M200 140 L400 140 L418 230 L452 690 L352 698 L306 330 L294 330 L248 698 L148 690 L182 230 Z',
  blazer: 'M240 140 L300 300 L360 140 L450 180 L505 470 L452 486 L418 330 L428 640 Q300 668 172 640 L182 330 L148 486 L95 470 L150 180 Z',
  skirt: 'M215 210 L385 210 L392 260 L470 650 Q300 690 130 650 L208 260 Z',
  knit: 'M240 150 Q300 190 360 150 L452 190 L520 500 Q505 520 470 512 L410 300 L418 600 Q300 626 182 600 L190 300 L130 512 Q95 520 80 500 L148 190 Z',
  coat: 'M235 120 L300 260 L365 120 L455 165 L512 590 L460 604 L420 330 L432 720 Q300 744 168 720 L180 330 L140 604 L88 590 L145 165 Z',
  tee: 'M240 170 Q300 200 360 170 L470 215 L500 320 L440 340 L415 290 L420 590 Q300 612 180 590 L185 290 L160 340 L100 320 L130 215 Z',
};

const palettes = [
  ['#ece6dd', '#c9b8a3'], ['#e9e4dc', '#2f2c28'], ['#efe9e1', '#a28c76'], ['#e7e3dc', '#7d8270'],
  ['#ede5df', '#b9998c'], ['#e5e2dd', '#4a4f57'], ['#f0ebe4', '#e4d9c8'], ['#e8e1d8', '#8b6f58'],
];

const items = [
  ['dress-linen', 'dress', 0], ['dress-black', 'dress', 1], ['dress-terracotta', 'dress', 4],
  ['blouse-white', 'blouse', 6], ['blouse-sand', 'blouse', 2], ['trousers-wide', 'trousers', 1],
  ['trousers-olive', 'trousers', 3], ['blazer-beige', 'blazer', 0], ['blazer-graphite', 'blazer', 5],
  ['skirt-midi', 'skirt', 2], ['skirt-satin', 'skirt', 7], ['knit-cream', 'knit', 6], ['knit-mocha', 'knit', 7],
  ['coat-camel', 'coat', 2], ['coat-black', 'coat', 1], ['tee-basic', 'tee', 6], ['tee-graphite', 'tee', 5],
];

for (const [name, shape, p] of items) {
  const [bg, fill] = palettes[p];
  for (const variant of [1, 2]) {
    const tilt = variant === 1 ? 0 : -4;
    const scale = variant === 1 ? 1 : 1.08;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg}" stop-opacity=".82"/></linearGradient>
    <linearGradient id="sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".10"/><stop offset=".45" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  ${variant === 2 ? `<circle cx="470" cy="150" r="190" fill="${fill}" opacity=".07"/>` : ''}
  <ellipse cx="300" cy="735" rx="190" ry="16" fill="#000" opacity=".08" filter="url(#soft)"/>
  <g transform="translate(300 420) rotate(${tilt}) scale(${scale}) translate(-300 -420)">
    <path d="${shapes[shape]}" fill="${fill}"/>
    <path d="${shapes[shape]}" fill="url(#sh)"/>
    <path d="M300 160 L300 ${shape === 'trousers' ? 330 : 620}" stroke="#000" stroke-opacity=".06" stroke-width="2"/>
  </g>
</svg>`;
    fs.writeFileSync(path.join(out, `${name}-${variant}.svg`), svg);
  }
}

const heroes = [['hero-1', '#d9cfc2', '#a28c76'], ['hero-2', '#cfd1c8', '#5d6355'], ['hero-3', '#e2d6cc', '#8b6f58']];
for (const [name, bg, accent] of heroes) {
  fs.writeFileSync(
    path.join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900" preserveAspectRatio="xMidYMid slice">
  <rect width="1600" height="900" fill="${bg}"/>
  <circle cx="1180" cy="430" r="330" fill="${accent}" opacity=".22"/>
  <circle cx="1320" cy="250" r="140" fill="#fff" opacity=".18"/>
  <g transform="translate(1180 470) scale(1.05) translate(-300 -420)"><path d="${shapes.dress}" fill="${accent}"/></g>
  <g transform="translate(860 520) scale(.78) rotate(-6) translate(-300 -420)" opacity=".9"><path d="${shapes.coat}" fill="#efe9e1"/></g>
</svg>`,
  );
}
console.log('demo images written to', out);

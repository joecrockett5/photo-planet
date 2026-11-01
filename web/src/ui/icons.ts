/**
 * Pixel-art icons as crisp SVG. Each is drawn on a small grid ('#' = filled)
 * and sized in art pixels via --px, so they match the canvas pixel scale.
 */
const ICONS = {
  plus: ['..#..', '..#..', '#####', '..#..', '..#..'],
  close: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  left: ['..#', '.#.', '#..', '.#.', '..#'],
  right: ['#..', '.#.', '..#', '.#.', '#..'],
  play: ['#..', '##.', '###', '##.', '#..'],
  down: ['..#..', '..#..', '#.#.#', '.###.', '..#..', '#####'],
  pin: ['.###.', '#...#', '#...#', '.#.#.', '..#..'],
  trash: ['.###.', '#####', '.#.#.', '.#.#.', '.###.'],
  cloud: ['..##.....', '.####.##.', '#########', '.#######.'],
  check: ['....#', '...##', '#.##.', '###..', '.#...'],
  unpin: ['.###.', '#...#', '#...#', '.#.#.', '..#..', '#####'],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const rows = ICONS[name];
  const w = rows[0]!.length;
  const hgt = rows.length;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  svg.style.setProperty('--w', String(w));
  svg.style.setProperty('--h', String(hgt));
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') d += `M${x} ${y}h1v1h-1z`;
  });
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

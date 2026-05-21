const RUSSIAN_QWERTY_BY_LATIN: Record<string, string> = {
  '`': '\u0451',
  q: '\u0439',
  w: '\u0446',
  e: '\u0443',
  r: '\u043a',
  t: '\u0435',
  y: '\u043d',
  u: '\u0433',
  i: '\u0448',
  o: '\u0449',
  p: '\u0437',
  '[': '\u0445',
  ']': '\u044a',
  a: '\u0444',
  s: '\u044b',
  d: '\u0432',
  f: '\u0430',
  g: '\u043f',
  h: '\u0440',
  j: '\u043e',
  k: '\u043b',
  l: '\u0434',
  ';': '\u0436',
  "'": '\u044d',
  z: '\u044f',
  x: '\u0447',
  c: '\u0441',
  v: '\u043c',
  b: '\u0438',
  n: '\u0442',
  m: '\u044c',
  ',': '\u0431',
  '.': '\u044e',
  '/': '.',
};

export function matchesShortcut(input: string, shortcut: string): boolean {
  const latin = shortcut.toLowerCase();
  const russian = RUSSIAN_QWERTY_BY_LATIN[latin];

  return (
    input === latin ||
    input === latin.toUpperCase() ||
    input === russian ||
    input === russian?.toUpperCase()
  );
}

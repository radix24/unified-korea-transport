// 색 배지 글자색: 밝은 바탕(주황·노랑·연회색 정당색 등)에는 흰 글자 대신 진한 글자를 써서 대비 4.5:1을 맞춘다.
function lum(hex) {
  const h = String(hex).replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const INK = '#1d232b', INK_L = lum(INK);

/** 배지 style 속성: 흰 글자와 진한 글자 가운데 바탕과 대비가 더 큰 쪽 (빨강처럼 둘 다 4.5:1에 못 미치면 덜 나쁜 쪽) */
export function badgeStyle(bg) {
  if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(bg))) return `background:${bg}`;
  const l = lum(bg), white = 1.05 / (l + 0.05), dark = (l + 0.05) / (INK_L + 0.05);
  return `background:${bg};color:${white >= dark ? '#ffffff' : INK}`;
}

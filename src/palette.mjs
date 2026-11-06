/** District colors. Hue is an identity cue, never a health/status score.
 * Labels and line patterns carry meaning without relying on color alone.
 */
export const ARCHITECTURAL_TONES = Object.freeze({
  brick: { name: 'Terracotta', hex: '#e69c88' },
  brass: { name: 'Ochre', hex: '#ddc17f' },
  moss: { name: 'Lichen', hex: '#b8c98d' },
  fern: { name: 'Sage', hex: '#94c9a3' },
  verdigris: { name: 'Patina', hex: '#79c9b8' },
  glacier: { name: 'Glacier', hex: '#86bfd1' },
  azure: { name: 'Slate blue', hex: '#96b0d7' },
  orchid: { name: 'Lilac', hex: '#b6a2d3' },
  rose: { name: 'Rose', hex: '#d6a3b7' },
  stone: { name: 'Limestone', hex: '#bfcec1' },
});
export const TONES = Object.freeze({
  brick: { name: 'Coral', hex: '#ff765f' },
  brass: { name: 'Amber', hex: '#ffd166' },
  moss: { name: 'Citron', hex: '#c5eb65' },
  fern: { name: 'Jade', hex: '#46e6ae' },
  verdigris: { name: 'Turquoise', hex: '#19d9d1' },
  glacier: { name: 'Cyan', hex: '#39c8ff' },
  azure: { name: 'Cobalt', hex: '#668cff' },
  orchid: { name: 'Amethyst', hex: '#b783ff' },
  rose: { name: 'Fuchsia', hex: '#ff65b5' },
  stone: { name: 'Pearl', hex: '#bdcadf' },
});
export const MATTE_COLORS = Object.freeze({
  brick: '#fb9890', brass: '#d2b471', moss: '#b0c080', fern: '#8ac997',
  verdigris: '#5dcdc1', glacier: '#5ec7e6', azure: '#84bcfa',
  orchid: '#da9ee3', rose: '#f197bf', stone: '#afb9c3',
});
export function normalizeAppearance(value) {
  return ['luminous', 'matte', 'architectural'].includes(value) ? value : 'luminous';
}
export const RAMP_ORDER = ['brick', 'brass', 'moss', 'fern', 'verdigris', 'glacier', 'azure', 'orchid', 'rose', 'stone'];
const EIGHT = ['brick', 'brass', 'fern', 'verdigris', 'glacier', 'azure', 'orchid', 'rose'];
export function tonesFor(count) { return (count <= 8 ? EIGHT : RAMP_ORDER).slice(0, count); }
export function tone(key) { return TONES[key] ?? TONES.stone; }
export const toneHex = (key) => tone(key).hex;
export function resolveDistrictColors(districts) {
  const defaults = tonesFor(districts.length);
  return districts.map((district, index) => {
    const key = district.tone ?? defaults[index];
    const appearanceColors = district.color ? null : {
      luminous: toneHex(key),
      matte: MATTE_COLORS[key] ?? MATTE_COLORS.stone,
      architectural: (ARCHITECTURAL_TONES[key] ?? ARCHITECTURAL_TONES.stone).hex,
    };
    // Literal colors in third-party packs remain authoritative in every finish.
    return { ...district, tone: key, color: district.color ?? toneHex(key), appearanceColors };
  });
}

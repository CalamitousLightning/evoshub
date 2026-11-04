/* EVOS HUB — accent presets for the Hub's own pages (Home, Profile).
 * The presets themselves live in css/theme.css (html[data-accent="..."]);
 * this module only stores the choice and sets data-accent on <html>.
 * The inline snippet in each Hub page applies the saved choice before first
 * paint; initTheme() re-applies it once the module loads. */
const KEY = 'evos_accent_theme';

export const THEMES = [
    { id: 'default', label: 'Blue',    swatch: '#4c7eff' },
    { id: 'ocean',   label: 'Ocean',   swatch: '#2fb8e0' },
    { id: 'emerald', label: 'Emerald', swatch: '#33d6a6' },
    { id: 'purple',  label: 'Purple',  swatch: '#9b6bff' },
    { id: 'rose',    label: 'Rose',    swatch: '#ff6b9d' },
    { id: 'gold',    label: 'Gold',    swatch: '#e0b23c' },
];

export function getTheme() {
    try {
        const t = localStorage.getItem(KEY);
        return THEMES.some((x) => x.id === t) ? t : 'default';
    } catch (e) { return 'default'; }
}

export function applyTheme(id) {
    const theme = THEMES.some((x) => x.id === id) ? id : 'default';
    const root = document.documentElement;
    if (theme === 'default') root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* storage blocked */ }
}

export function initTheme() {
    const theme = getTheme();
    const root = document.documentElement;
    if (theme === 'default') root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', theme);
}

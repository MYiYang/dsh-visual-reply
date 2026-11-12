/**
 * Config resolution for dsh-visual-reply.
 *
 * Every knob is optional; the loader row may override any subset. Unknown keys
 * are dropped (a typo must not silently change behaviour) and every value is
 * clamped here, so the rest of the plugin can trust what it reads.
 *
 * @module dsh-visual-reply/lib/config
 */

/** Default configuration. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Master switch: the tool registers only when true. */
  enabled: true,
  /** Hard cap on the HTML fragment, in bytes (UTF-8). */
  maxHtmlBytes: 204800,
  /** Suggested maximum iframe height, px. Clamped to [MIN_HEIGHT, MAX_HEIGHT]. */
  defaultHeight: 480,
  /** External `<script src>` hosts that may be loaded inside the sandbox. */
  allowedScriptHosts: ['cdn.jsdelivr.net'],
  /** Write a copy of every rendered visual under $DSH_HOME/visual-reply/. */
  archive: false,
  /** Add the "when to draw" section to the system prompt. */
  injectPrompt: true,
  /** $DSH_HOME override; empty = $DSH_HOME env or ~/.dsh. */
  dshHome: '',
})

/** Smallest iframe height the model may ask for. */
export const MIN_HEIGHT = 240
/** Largest iframe height the model may ask for. */
export const MAX_HEIGHT = 1024
/** Title length cap, characters. */
export const MAX_TITLE_CHARS = 120

/**
 * Coerce one numeric knob into an integer range.
 * @param {unknown} value - raw value from config.
 * @param {number} fallback - value to use when the raw one is unusable.
 * @param {number} min - inclusive lower bound.
 * @param {number} max - inclusive upper bound.
 * @returns {number} the clamped integer.
 */
function intIn(value, fallback, min, max) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.round(num)))
}

/**
 * Normalize a host allowlist: lowercase, no scheme/path/wildcard prefixes,
 * empty entries dropped, duplicates removed.
 * @param {unknown} value - raw list from config.
 * @returns {string[]} the normalized host list (may be empty).
 */
export function normalizeHosts(value) {
  if (!Array.isArray(value)) return [...DEFAULT_CONFIG.allowedScriptHosts]
  const out = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    let host = entry.trim().toLowerCase()
    if (host === '') continue
    host = host.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')
    if (host === '' || out.includes(host)) continue
    out.push(host)
  }
  return out
}

/**
 * Resolve a loader-row config into a trusted shape.
 * @param {Record<string, unknown>} [config] - raw loader config.
 * @returns {{enabled: boolean, maxHtmlBytes: number, defaultHeight: number, allowedScriptHosts: string[], archive: boolean, injectPrompt: boolean, dshHome: string}} the effective config.
 */
export function resolveConfig(config = {}) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  return {
    enabled: raw.enabled === undefined ? DEFAULT_CONFIG.enabled : raw.enabled === true,
    maxHtmlBytes: intIn(raw.maxHtmlBytes, DEFAULT_CONFIG.maxHtmlBytes, 4096, 2 * 1024 * 1024),
    defaultHeight: intIn(raw.defaultHeight, DEFAULT_CONFIG.defaultHeight, MIN_HEIGHT, MAX_HEIGHT),
    allowedScriptHosts: normalizeHosts(raw.allowedScriptHosts),
    archive: raw.archive === true,
    injectPrompt: raw.injectPrompt === undefined ? DEFAULT_CONFIG.injectPrompt : raw.injectPrompt === true,
    dshHome: typeof raw.dshHome === 'string' ? raw.dshHome.trim() : '',
  }
}

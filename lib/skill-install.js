/**
 * Bundled-skill installer.
 *
 * The plugin ships `skills/<name>/SKILL.md`; on activation each one is copied
 * into `$DSH_HOME/skills/<name>/` so the "when to draw" rules travel with the
 * plugin instead of living in a README nobody opens. Idempotent and
 * version-aware: a newer bundled copy overwrites an older installed one, an
 * identical copy is left alone, and every failure degrades to a log line — a
 * missing skill must never keep the tool from mounting.
 *
 * The install ledger lives in the plugin's own state directory
 * (`$DSH_HOME/dsh-visual-reply/skills-installed.json`), not inside the skill
 * folder: DSH's skill watcher prunes files it does not recognise next to
 * SKILL.md, which would make every later bundle change look hand-installed.
 *
 * @module dsh-visual-reply/lib/skill-install
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The plugin's bundled skills directory. */
const BUNDLED_DIR = fileURLToPath(new URL('../skills', import.meta.url))

/** Ledger file name, inside our own state directory. */
const LEDGER = 'skills-installed.json'

/**
 * Resolve `$DSH_HOME`.
 * @param {string} [override] - config override, may be empty.
 * @returns {string} absolute DSH home.
 */
export function dshHome(override) {
  if (typeof override === 'string' && override.trim() !== '') return path.resolve(override.trim())
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return path.resolve(env.trim())
  return path.join(homedir(), '.dsh')
}

/**
 * The plugin's own state directory.
 * @param {string} [override] - config override, may be empty.
 * @returns {string} absolute directory.
 */
export function stateDir(override) {
  return path.join(dshHome(override), 'dsh-visual-reply')
}

/**
 * List bundled skills.
 * @returns {Array<{name: string, dir: string}>} one entry per skill directory.
 */
function bundledSkills() {
  let entries
  try {
    entries = readdirSync(BUNDLED_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(BUNDLED_DIR, entry.name)
    if (existsSync(path.join(dir, 'SKILL.md'))) out.push({ name: entry.name, dir })
  }
  return out
}

/**
 * Read a frontmatter-free fingerprint of one skill file.
 * @param {string} file - absolute path.
 * @returns {string} the content, or an empty string when unreadable.
 */
function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Load the install ledger.
 * @param {string} dir - state directory.
 * @returns {Record<string, string>} skill name → fingerprint.
 */
function readLedger(dir) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, LEDGER), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    /* a corrupt ledger just means "reinstall everything" */
  }
  return {}
}

/**
 * Persist the install ledger.
 * @param {string} dir - state directory.
 * @param {Record<string, string>} ledger - skill name → fingerprint.
 * @returns {void}
 */
function writeLedger(dir, ledger) {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, LEDGER), JSON.stringify(ledger, null, 2), 'utf8')
  } catch {
    /* the ledger is an optimization, not a requirement */
  }
}

/**
 * Copy one directory tree (skills are shallow, but references may nest).
 * @param {string} from - source directory.
 * @param {string} to - destination directory.
 * @returns {void}
 */
function copyDir(from, to) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else copyFileSync(src, dst)
  }
}

/**
 * Install every bundled skill whose content changed since last install.
 * @param {(level: string, message: string) => void} log - logger sink.
 * @param {string} [dshHomeOverride] - config override, may be empty.
 * @returns {string[]} names of the skills actually written this run.
 */
export function installBundledSkills(log, dshHomeOverride) {
  const target = path.join(dshHome(dshHomeOverride), 'skills')
  const state = stateDir(dshHomeOverride)
  const ledger = readLedger(state)
  const written = []
  for (const skill of bundledSkills()) {
    const source = path.join(skill.dir, 'SKILL.md')
    const fingerprint = readText(source)
    if (fingerprint === '') continue
    const installed = readText(path.join(target, skill.name, 'SKILL.md'))
    if (installed === fingerprint) continue
    try {
      rmSync(path.join(target, skill.name), { recursive: true, force: true })
      copyDir(skill.dir, path.join(target, skill.name))
      ledger[skill.name] = fingerprint
      written.push(skill.name)
    } catch (error) {
      log('warn', `skill "${skill.name}" install failed: ${String(error)}`)
    }
  }
  if (written.length > 0) writeLedger(state, ledger)
  return written
}

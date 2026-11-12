/**
 * Bundled-skill installer: idempotent, version-aware, and — the point of this
 * file — never silently destroys a SKILL.md the user edited by hand.
 *
 * Contract:
 *   - first activation copies the bundled skill and records its fingerprint;
 *   - an unchanged copy is left alone;
 *   - a hand-edited copy is kept (with a warning), not overwritten;
 *   - an older copy this plugin installed itself is upgraded in place.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { installBundledSkills, stateDir } from '../lib/skill-install.js'

const home = mkdtempSync(path.join(tmpdir(), 'vr-skill-'))
const installedPath = path.join(home, 'skills/visual-reply/SKILL.md')
const ledgerPath = path.join(stateDir(home), 'skills-installed.json')

/** Collect log lines so a skipped overwrite can be asserted. */
function collector() {
  const lines = []
  return { lines, log: (level, message) => lines.push(`${level}: ${message}`) }
}

// ── 1. 首次安装 ───────────────────────────────────────────────────────────
{
  const { log, lines } = collector()
  const written = installBundledSkills(log, home)
  assert.deepEqual(written, ['visual-reply'])
  assert.equal(existsSync(installedPath), true)
  const bundled = readFileSync(new URL('../skills/visual-reply/SKILL.md', import.meta.url), 'utf8')
  assert.equal(readFileSync(installedPath, 'utf8'), bundled)
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  assert.equal(ledger['visual-reply'], bundled, '账本记的是内容指纹')
  assert.deepEqual(lines, [])
}

// ── 2. 内容没变：不重装、不写盘 ───────────────────────────────────────────
{
  const { log } = collector()
  assert.deepEqual(installBundledSkills(log, home), [])
}

// ── 3. 用户手改过：保留原样，只告警 ───────────────────────────────────────
{
  const edited = `${readFileSync(installedPath, 'utf8')}\n<!-- 本地改动：加一条自己的规则 -->\n`
  writeFileSync(installedPath, edited, 'utf8')
  const { log, lines } = collector()
  const written = installBundledSkills(log, home)
  assert.deepEqual(written, [], '手改过的技能不该被覆盖')
  assert.equal(readFileSync(installedPath, 'utf8'), edited, '本地改动必须原样保留')
  assert.equal(lines.some((line) => line.startsWith('warn:') && line.includes('visual-reply')), true)
  assert.equal(lines.some((line) => line.includes('delete $DSH_HOME/skills/visual-reply')), true)
}

// ── 4. 上一版是本插件装的：按新包内容升级 ─────────────────────────────────
{
  // 模拟「装着 0.2.0 的内容、账本记着 0.2.0 的指纹」。
  const oldContent = '# visual-reply (0.2.0)\n'
  writeFileSync(installedPath, oldContent, 'utf8')
  writeFileSync(ledgerPath, JSON.stringify({ 'visual-reply': oldContent }, null, 2), 'utf8')
  const { log } = collector()
  const written = installBundledSkills(log, home)
  assert.deepEqual(written, ['visual-reply'], '自己装过的旧版本应升级')
  const bundled = readFileSync(new URL('../skills/visual-reply/SKILL.md', import.meta.url), 'utf8')
  assert.equal(readFileSync(installedPath, 'utf8'), bundled)
}

// ── 5. 删掉技能目录后可以强制重装 ─────────────────────────────────────────
{
  rmSync(path.join(home, 'skills/visual-reply'), { recursive: true, force: true })
  const { log } = collector()
  assert.deepEqual(installBundledSkills(log, home), ['visual-reply'])
}

rmSync(home, { recursive: true, force: true })
console.log('skill-install.test.js: ok')

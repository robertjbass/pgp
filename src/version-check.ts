import { execSync, execFile } from 'child_process'
import { colors, showSuccess, showError, showLoading, printBanner } from './ui.js'

const PROBE_TIMEOUT_MS = 4000

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: 'utf-8', timeout: PROBE_TIMEOUT_MS },
      (error, stdout) => resolve(error ? null : stdout.trim()),
    )
  })
}

// Both probes are memoised for the life of the process so the key-management
// menu only pays for them once, and never blocks on a slow or offline network
// for more than the timeout.
let installedVersionPromise: Promise<string | null> | null = null
let latestVersionPromise: Promise<string | null> | null = null

/**
 * Version of the globally installed `lpgp` binary, whichever package manager
 * put it on PATH. Null when nothing is installed.
 */
export function getInstalledVersion(): Promise<string | null> {
  if (!installedVersionPromise) {
    installedVersionPromise = (async () => {
      const path = await run('which', ['lpgp'])
      if (!path) return null
      const out = await run('lpgp', ['--version'])
      const match = out?.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)
      return match?.[0] ?? null
    })()
  }
  return installedVersionPromise
}

export function getLatestVersion(): Promise<string | null> {
  if (!latestVersionPromise) {
    latestVersionPromise = run('npm', ['view', 'lpgp', 'version'])
  }
  return latestVersionPromise
}

export function detectPackageManager(): 'pnpm' | 'yarn' | 'npm' {
  try {
    execSync('which pnpm 2>/dev/null', {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return 'pnpm'
  } catch {
    try {
      execSync('which yarn 2>/dev/null', {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return 'yarn'
    } catch {
      return 'npm'
    }
  }
}

/**
 * True when v1 < v2. Compares the numeric major.minor.patch only; a
 * prerelease tag (`1.2.0-beta.1`) is treated as older than its release.
 */
export function isOlderVersion(v1: string, v2: string): boolean {
  const parse = (v: string) => {
    const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/)
    if (!m) return { parts: [0, 0, 0], pre: false }
    return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: !!m[4] }
  }
  const a = parse(v1)
  const b = parse(v2)
  for (let i = 0; i < 3; i++) {
    if ((a.parts[i] ?? 0) < (b.parts[i] ?? 0)) return true
    if ((a.parts[i] ?? 0) > (b.parts[i] ?? 0)) return false
  }
  return a.pre && !b.pre
}

export async function installOrUpdateGlobally(
  isUpdate: boolean,
): Promise<boolean> {
  printBanner()

  const pm = detectPackageManager()
  const action = isUpdate ? 'Updating' : 'Installing'
  const cmd = pm === 'yarn' ? `yarn global add lpgp` : `${pm} install -g lpgp`

  showLoading(`${action} lpgp globally…`)
  console.log()
  console.log(colors.muted(`  ${cmd}`))
  console.log()

  try {
    execSync(cmd, { stdio: 'inherit' })
    console.log()
    if (isUpdate) {
      showSuccess('lpgp updated.')
    } else {
      showSuccess('lpgp installed. Run it anywhere with `lpgp`.')
    }
    console.log()
    return true
  } catch {
    console.log()
    showError(
      `Failed to ${isUpdate ? 'update' : 'install'}. You may need to run with sudo:`,
    )
    console.log(colors.muted(`  sudo ${cmd}`))
    console.log()
    return false
  }
}

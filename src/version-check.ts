import { execSync } from 'child_process'
import { colors, showSuccess, showError, showLoading, printBanner } from './ui.js'

export function getInstalledVersion(): string | null {
  try {
    execSync('which lpgp 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const version = execSync('npm list -g lpgp --json 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(version)
    return parsed.dependencies?.lpgp?.version || null
  } catch {
    return null
  }
}

export function getLatestVersion(): string | null {
  try {
    const result = execSync('npm view lpgp version 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return result.trim()
  } catch {
    return null
  }
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

export function isOlderVersion(v1: string, v2: string): boolean {
  const p1 = v1.split('.').map(Number)
  const p2 = v2.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((p1[i] || 0) < (p2[i] || 0)) return true
    if ((p1[i] || 0) > (p2[i] || 0)) return false
  }
  return false
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

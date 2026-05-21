/**
 * UI Constants and Helpers
 * Provides consistent styling across the CLI application
 */
import chalk from 'chalk'

// ============================================================================
// Color Palette
// ============================================================================

export const colors = {
  // Primary brand color for banners and headings
  primary: chalk.cyan,
  primaryBold: chalk.cyan.bold,

  // Success states
  success: chalk.green,
  successBold: chalk.green.bold,

  // Warning/prompt states
  warning: chalk.yellow,
  warningBold: chalk.yellow.bold,

  // Error states
  error: chalk.red,
  errorBold: chalk.red.bold,

  // Muted/secondary text
  muted: chalk.gray,
  mutedDim: chalk.dim,

  // Accent colors for special elements
  accent: chalk.magenta,
  accentBold: chalk.magenta.bold,
  info: chalk.blue,
  infoBold: chalk.blue.bold,
}

// ============================================================================
// Icons with Colors
// ============================================================================

export const icons = {
  // Actions
  encrypt: chalk.cyan('→'),
  decrypt: chalk.cyan('←'),
  add: chalk.green('+'),
  generate: chalk.green('+'),
  import: chalk.green('↓'),
  export: chalk.blue('↑'),

  // Navigation
  back: chalk.gray('←'),
  home: chalk.gray('⌂'),
  exit: chalk.red('×'),

  // Items
  key: chalk.yellow('★'),
  contact: chalk.magenta('◆'),
  clipboard: chalk.blue('▣'),
  editor: chalk.blue('▤'),
  inline: chalk.blue('▢'),
  gpg: chalk.yellow('#'),

  // Status
  success: chalk.green('✓'),
  error: chalk.red('✗'),
  warning: chalk.yellow('!'),
  info: chalk.cyan('ℹ'),
  loading: chalk.blue('⏳'),
  locked: chalk.yellow('◐'),
  unlocked: chalk.green('○'),

  // Selection markers
  default: chalk.green('✓'),
  selected: chalk.cyan('●'),
  unselected: chalk.gray('○'),

  // Misc
  edit: chalk.cyan('~'),
  notes: chalk.gray('>'),
  trust: chalk.yellow('★'),
  copy: chalk.blue('▪'),
  view: chalk.gray('▫'),
  multiple: chalk.magenta('+'),
  loop: chalk.cyan('↻'),
}

// ============================================================================
// Banner and Headers
// ============================================================================

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const APP_NAME = 'lpgp'

let _version: string | undefined
function getVersion(): string {
  if (_version !== undefined) return _version
  let resolved = ''
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8'))
    if (typeof pkg.version === 'string') resolved = pkg.version
  } catch {
    // fall through
  }
  _version = resolved
  return resolved
}

export function printBanner(): void {
  console.clear()
  const version = getVersion()
  const tag = version ? colors.muted(` · v${version}`) : ''
  console.log()
  console.log(`  ${colors.primaryBold(APP_NAME)}${tag}`)
  console.log()
}

export function printHomeStatus(activeKey: string | null): void {
  if (!activeKey) return
  console.log(`  ${colors.muted(activeKey)}`)
  console.log()
}

export function printSectionHeader(title: string): void {
  console.log()
  console.log(`  ${colors.infoBold(title)}`)
  console.log(`  ${colors.muted('─'.repeat(title.length))}`)
  console.log()
}

export function printDivider(): void {
  console.log(colors.muted('─'.repeat(50)))
}

// ============================================================================
// Status Messages
// ============================================================================

export function showSuccess(message: string): void {
  console.log(colors.success(`${icons.success} ${message}`))
}

export function showError(message: string): void {
  console.log(colors.error(`${icons.error} ${message}`))
}

export function showWarning(message: string): void {
  console.log(colors.warning(`${icons.warning} ${message}`))
}

export function showInfo(message: string): void {
  console.log(colors.info(`${icons.info} ${message}`))
}

export function showLoading(message: string): void {
  console.log(colors.info(`${icons.loading} ${message}`))
}

// ============================================================================
// Menu Formatting
// ============================================================================

/**
 * Format a menu choice with icon and optional description
 */
export function menuChoice(
  icon: string,
  label: string,
  description?: string
): string {
  if (description) {
    return `${icon} ${label} ${colors.muted(`(${description})`)}`
  }
  return `${icon} ${label}`
}

/**
 * Standard navigation choices for menus
 */
export function backChoice(label: string = 'Back'): {
  name: string
  value: string
} {
  return { name: `${icons.back} ${label}`, value: 'back' }
}

export function mainMenuChoice(): { name: string; value: string } {
  return {
    name: `${icons.home} Main menu ${colors.muted('(esc)')}`,
    value: 'main-menu',
  }
}

export function exitChoice(): { name: string; value: string } {
  return { name: `${icons.exit} Exit`, value: 'exit' }
}

export function cancelChoice(): { name: string; value: string } {
  return { name: `${icons.back} Cancel`, value: 'cancel' }
}

// ============================================================================
// Content Display
// ============================================================================

/**
 * Display content in a bordered box
 */
export function showContentBox(title: string, content: string): void {
  console.log(colors.successBold(`${title}\n`))
  printDivider()
  console.log(content)
  printDivider()
}

/**
 * Display a key-value pair
 */
export function showKeyValue(
  key: string,
  value: string | number | boolean | null
): void {
  const displayValue = value === null ? colors.muted('(none)') : String(value)
  console.log(`${colors.muted(key + ':')} ${displayValue}`)
}

// ============================================================================
// Prompt Helpers
// ============================================================================

/**
 * Format a prompt message consistently
 */
export function promptMessage(message: string): string {
  return colors.primary(message)
}

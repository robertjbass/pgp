import inquirer from 'inquirer'
import chalk from 'chalk'

// Navigation sentinel values for menu navigation
export const BACK_VALUE = '__back__'
export const MAIN_MENU_VALUE = '__main__'
export const ESCAPE_VALUE = '__escape__'

// Global escape handler state
let globalEscapeEnabled = false
let escapeTriggered = false
let escapeReject: ((error: Error) => void) | null = null
let currentPromptUi: { close?: () => void } | null = null

// Custom error class for escape key press
export class EscapeError extends Error {
  constructor() {
    super('Escape pressed')
    this.name = 'EscapeError'
  }
}

/**
 * True when the chunk is exactly one byte equal to `byte`. stdin may deliver
 * Buffers or, once something has called `stdin.setEncoding()`, strings, so
 * both are handled. (The inline editor sets utf8 encoding and Node offers no
 * way to unset it.)
 */
function isSingleByte(data: Buffer | string, byte: number): boolean {
  if (data.length !== 1) return false
  return typeof data === 'string' ? data.charCodeAt(0) === byte : data[0] === byte
}

// Handler for escape key detection
function onEscapeData(data: Buffer | string): void {
  // Ctrl+C is byte 3 - handle graceful exit
  if (isSingleByte(data, 3)) {
    console.log(chalk.gray('\n  Goodbye!\n'))
    process.exit(0)
  }

  // Escape key is byte 27 (0x1b) by itself
  // Arrow keys and other sequences start with 27 but have more bytes
  if (isSingleByte(data, 27)) {
    escapeTriggered = true
    // First reject the escape promise to interrupt the prompt
    if (escapeReject) {
      const reject = escapeReject
      escapeReject = null
      reject(new EscapeError())
    }
    // Then close the prompt UI to stop it from rendering
    if (currentPromptUi?.close) {
      try {
        currentPromptUi.close()
      } catch {
        // Swallow errors from inquirer internals
      }
      currentPromptUi = null
    }
    // Clear the screen
    console.clear()
  }
}

// Enable global escape key handling for the interactive menu
export function enableGlobalEscape(): void {
  if (globalEscapeEnabled) return
  globalEscapeEnabled = true
  process.stdin.on('data', onEscapeData)
}

// Disable global escape key handling and clean up state
export function disableGlobalEscape(): void {
  if (!globalEscapeEnabled) return
  process.stdin.off('data', onEscapeData)
  globalEscapeEnabled = false
  escapeTriggered = false
  escapeReject = null
  currentPromptUi = null
}

// Check if escape was triggered and reset the flag
export function checkAndResetEscape(): boolean {
  const wasTriggered = escapeTriggered
  escapeTriggered = false
  return wasTriggered
}

// Apply sensible defaults to list-style prompts: no wrap-around, fit page to
// content for short lists. Keeps the call sites concise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyListDefaults(questions: any): any {
  const enhance = (q: any) => {
    if (q && (q.type === 'list' || q.type === 'rawlist')) {
      const choices = Array.isArray(q.choices) ? q.choices : []
      const next = { ...q }
      if (next.loop === undefined) next.loop = false
      if (next.pageSize === undefined && choices.length > 0 && choices.length <= 20) {
        next.pageSize = choices.length
      }
      return next
    }
    return q
  }
  if (Array.isArray(questions)) return questions.map(enhance)
  return enhance(questions)
}

// Wrapper for inquirer.prompt that supports escape key
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function escapeablePrompt<T = any>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  questions: any
): Promise<T> {
  // Detect non-interactive mode
  if (!process.stdin.isTTY) {
    throw new Error('Cannot prompt in non-interactive mode.')
  }

  // Create a promise that rejects when escape is pressed
  const escapePromise = new Promise<never>((_, reject) => {
    escapeReject = reject
  })

  try {
    const p = inquirer.prompt(applyListDefaults(questions))
    // Register the prompt UI so we can close it on escape
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promptWithUi = p as any
    if (
      promptWithUi.ui &&
      typeof promptWithUi.ui === 'object' &&
      promptWithUi.ui !== null &&
      typeof promptWithUi.ui.close === 'function'
    ) {
      currentPromptUi = promptWithUi.ui as { close: () => void }
    } else {
      currentPromptUi = null
    }

    // Race the prompt against the escape promise
    const result = (await Promise.race([p, escapePromise])) as T
    return result
  } finally {
    escapeReject = null
    currentPromptUi = null
  }
}

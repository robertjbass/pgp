import { colors, promptMessage } from './ui.js'
import {
  EscapeError,
  disableGlobalEscape,
  enableGlobalEscape,
} from './prompts.js'

function termWidth(): number {
  return Math.max(1, process.stdout.columns || 80)
}

function rowsFor(text: string, width: number): number {
  const lines = text.split('\n')
  let rows = 0
  for (const line of lines) {
    rows += Math.max(1, Math.ceil(line.length / width))
  }
  return Math.max(rows, 1)
}

function cursorAt(
  text: string,
  idx: number,
  width: number,
): { row: number; col: number } {
  const before = text.slice(0, idx)
  const lines = before.split('\n')
  let row = 0
  for (let i = 0; i < lines.length - 1; i++) {
    const len = lines[i]?.length ?? 0
    row += Math.max(1, Math.ceil(len / width))
  }
  const lastLineLen = lines[lines.length - 1]?.length ?? 0
  row += Math.floor(lastLineLen / width)
  const col = lastLineLen % width
  return { row, col }
}

export async function readInlineMultiline(
  promptText: string,
  hint?: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Cannot read inline input in non-TTY mode'))
      return
    }

    console.log(promptMessage(promptText))
    console.log(
      colors.muted(
        hint ??
          '(Arrows/Backspace work across lines. Ctrl+D when done, Esc to cancel)',
      ),
    )

    let buffer = ''
    let cursor = 0
    let curRow = 0
    const stdin = process.stdin
    const stdout = process.stdout
    const wasRaw = stdin.isRaw

    disableGlobalEscape()
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    function repaint(): void {
      const width = termWidth()
      let out = '\r'
      if (curRow > 0) out += `\x1b[${curRow}A`
      out += '\x1b[J'
      out += buffer

      const endRow = rowsFor(buffer, width) - 1
      const { row: tRow, col: tCol } = cursorAt(buffer, cursor, width)

      const rowDelta = endRow - tRow
      if (rowDelta > 0) out += `\x1b[${rowDelta}A`
      out += '\r'
      if (tCol > 0) out += `\x1b[${tCol}C`

      curRow = tRow
      stdout.write(out)
    }

    function moveCursorToBottom(): void {
      const width = termWidth()
      const endRow = rowsFor(buffer, width) - 1
      const downMoves = endRow - curRow
      let out = ''
      if (downMoves > 0) out += `\x1b[${downMoves}B`
      out += '\r\n'
      stdout.write(out)
    }

    function cleanup(): void {
      stdin.setRawMode(wasRaw)
      stdin.removeListener('data', onData)
      enableGlobalEscape()
    }

    function finish(value: string): void {
      moveCursorToBottom()
      cleanup()
      resolve(value)
    }

    function abort(): void {
      moveCursorToBottom()
      cleanup()
      reject(new EscapeError())
    }

    function onData(input: string): void {
      if (input === '\x03') {
        cleanup()
        stdout.write('\n')
        process.kill(process.pid, 'SIGINT')
        return
      }
      if (input === '\x04') {
        finish(buffer)
        return
      }
      if (input === '\x1b') {
        abort()
        return
      }
      if (input === '\x7f' || input === '\x08') {
        if (cursor > 0) {
          buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor)
          cursor--
          repaint()
        }
        return
      }
      if (input === '\r' || input === '\n') {
        buffer = buffer.slice(0, cursor) + '\n' + buffer.slice(cursor)
        cursor++
        repaint()
        return
      }
      if (input === '\x1b[D') {
        if (cursor > 0) {
          cursor--
          repaint()
        }
        return
      }
      if (input === '\x1b[C') {
        if (cursor < buffer.length) {
          cursor++
          repaint()
        }
        return
      }
      if (input === '\x1b[A') {
        const before = buffer.slice(0, cursor)
        const lastNewline = before.lastIndexOf('\n')
        if (lastNewline === -1) {
          cursor = 0
        } else {
          const colInLine = cursor - lastNewline - 1
          const beforePrev = before.slice(0, lastNewline)
          const prevLineStart = beforePrev.lastIndexOf('\n') + 1
          const prevLineLen = lastNewline - prevLineStart
          cursor = prevLineStart + Math.min(colInLine, prevLineLen)
        }
        repaint()
        return
      }
      if (input === '\x1b[B') {
        const before = buffer.slice(0, cursor)
        const lastNewline = before.lastIndexOf('\n')
        const colInLine = cursor - lastNewline - 1
        const after = buffer.slice(cursor)
        const nextNlOffset = after.indexOf('\n')
        if (nextNlOffset === -1) {
          cursor = buffer.length
        } else {
          const nextLineStart = cursor + nextNlOffset + 1
          const afterNext = buffer.slice(nextLineStart)
          const nextLineEnd = afterNext.indexOf('\n')
          const nextLineLen =
            nextLineEnd === -1 ? afterNext.length : nextLineEnd
          cursor = nextLineStart + Math.min(colInLine, nextLineLen)
        }
        repaint()
        return
      }
      if (input === '\x1b[H' || input === '\x1b[1~') {
        const before = buffer.slice(0, cursor)
        cursor = before.lastIndexOf('\n') + 1
        repaint()
        return
      }
      if (input === '\x1b[F' || input === '\x1b[4~') {
        const after = buffer.slice(cursor)
        const nl = after.indexOf('\n')
        cursor = nl === -1 ? buffer.length : cursor + nl
        repaint()
        return
      }
      if (input === '\x1b[3~') {
        if (cursor < buffer.length) {
          buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1)
          repaint()
        }
        return
      }
      if (input.startsWith('\x1b')) return

      // Pasted text may carry CRLF line endings or tabs; keep the buffer to
      // plain newlines and spaces so armored blocks parse and columns line up.
      const text = input.replace(/\r\n?/g, '\n').replace(/\t/g, '  ')
      buffer = buffer.slice(0, cursor) + text + buffer.slice(cursor)
      cursor += text.length
      repaint()
    }

    stdin.on('data', onData)
  })
}

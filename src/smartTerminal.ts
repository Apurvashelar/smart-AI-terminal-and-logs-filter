/**
 * Smart Terminal — Custom PTY-based terminal with AI command generation.
 *
 * When the user types natural language, the AI translates it to a shell command
 * and shows an inline confirmation prompt. Regular shell commands pass through directly.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { CommandGenerator, GeneratedCommand, CommandContext } from './ai/commandGenerator';

/** Well-known shell command names used by classifyInput(). */
const KNOWN_COMMANDS = new Set([
  'ls', 'cd', 'pwd', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'find',
  'git', 'npm', 'npx', 'yarn', 'pnpm', 'node', 'python', 'python3', 'pip', 'pip3',
  'docker', 'kubectl', 'curl', 'wget', 'chmod', 'chown', 'sudo', 'echo', 'export',
  'source', 'make', 'cargo', 'go', 'dotnet', 'java', 'javac', 'gcc', 'g++', 'clang',
  'brew', 'apt', 'yum', 'dnf', 'pacman', 'ssh', 'scp', 'rsync', 'tar', 'zip', 'unzip',
  'ps', 'kill', 'top', 'htop', 'man', 'which', 'where', 'whoami', 'env', 'set', 'unset',
  'alias', 'touch', 'head', 'tail', 'wc', 'sort', 'uniq', 'sed', 'awk', 'xargs', 'tee',
  'diff', 'patch', 'vi', 'vim', 'nano', 'code', 'open', 'start', 'clear', 'history',
  'date', 'cal', 'df', 'du', 'free', 'uname', 'hostname', 'ping', 'traceroute',
  'nslookup', 'dig', 'nc', 'telnet', 'terraform', 'aws', 'gcloud', 'az', 'helm',
  'ansible', 'vagrant',
]);

export class SmartTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number | void>();
  onDidWrite = this.writeEmitter.event;
  onDidClose = this.closeEmitter.event;

  private inputBuffer: string = '';
  private childProcess: ChildProcess | null = null;
  private isAwaitingConfirmation: boolean = false;
  private pendingCommand: GeneratedCommand | null = null;
  private commandHistory: string[] = [];
  private cwd: string;
  private shell: string;
  private shellFlag: string;

  constructor(
    private commandGenerator: CommandGenerator | null,
    cwd: string,
    private onData?: (data: string) => void,
    private onCommandStart?: () => void
  ) {
    this.cwd = cwd;
    this.shell = process.platform === 'win32'
      ? (process.env.COMSPEC || 'cmd.exe')
      : (process.env.SHELL || '/bin/bash');
    this.shellFlag = process.platform === 'win32' ? '/c' : '-c';
  }

  open(_initialDimensions?: vscode.TerminalDimensions): void {
    this.writeEmitter.fire('\x1b[1;36mSmart AI Terminal\x1b[0m\r\n');
    this.writeEmitter.fire('Type natural language or shell commands. Prefix with \x1b[1m!\x1b[0m to force shell passthrough.\r\n');
    if (this.commandGenerator) {
      this.writeEmitter.fire('AI features: \x1b[32menabled\x1b[0m\r\n');
    } else {
      this.writeEmitter.fire('AI features: \x1b[33mdisabled\x1b[0m — Run \x1b[1mSmart Terminal: Set AI API Key\x1b[0m to enable.\r\n');
    }
    this.showPrompt();
  }

  handleInput(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];

      // Detect escape sequences (arrow keys, etc.) — ignore for MVP
      if (ch === '\x1b') {
        // Skip the rest of the escape sequence
        if (i + 1 < data.length && data[i + 1] === '[') {
          i += 2; // skip \x1b[
          // Skip any remaining sequence characters
          while (i < data.length && data[i] >= '0' && data[i] <= '~') {
            if (data[i] >= '@') { break; } // terminal character
            i++;
          }
        }
        continue;
      }

      // Ctrl+C
      if (ch === '\x03') {
        if (this.childProcess) {
          this.childProcess.kill('SIGINT');
          this.childProcess = null;
        }
        if (this.isAwaitingConfirmation) {
          this.isAwaitingConfirmation = false;
          this.pendingCommand = null;
          this.writeEmitter.fire('\r\n\x1b[33mCancelled.\x1b[0m');
        }
        this.inputBuffer = '';
        this.writeEmitter.fire('^C');
        this.showPrompt();
        continue;
      }

      // Ctrl+D
      if (ch === '\x04') {
        if (this.inputBuffer.length === 0 && !this.childProcess) {
          this.closeEmitter.fire(0);
          return;
        }
        continue;
      }

      // Backspace
      if (ch === '\x7f') {
        if (this.inputBuffer.length > 0) {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          this.writeEmitter.fire('\b \b');
        }
        continue;
      }

      // Enter
      if (ch === '\r') {
        this.writeEmitter.fire('\r\n');
        const input = this.inputBuffer.trim();
        this.inputBuffer = '';
        this.processInput(input);
        continue;
      }

      // Regular printable character
      if (ch >= ' ') {
        this.inputBuffer += ch;
        this.writeEmitter.fire(ch);
      }
    }
  }

  private processInput(input: string): void {
    // G4: Confirmation state must be checked FIRST
    if (this.isAwaitingConfirmation) {
      const lower = input.toLowerCase();
      if (lower === 'y' || lower === 'yes') {
        this.isAwaitingConfirmation = false;
        const cmd = this.pendingCommand!.command;
        this.pendingCommand = null;
        this.executeCommand(cmd);
        return;
      } else if (lower === 'n' || lower === 'no') {
        this.isAwaitingConfirmation = false;
        this.pendingCommand = null;
        this.writeEmitter.fire('\x1b[33mCancelled.\x1b[0m');
        this.showPrompt();
        return;
      } else if (lower === 'e' || lower === 'edit') {
        this.isAwaitingConfirmation = false;
        const cmd = this.pendingCommand!.command;
        this.pendingCommand = null;
        // Pre-fill the buffer with the command for editing
        this.inputBuffer = cmd;
        this.showPrompt();
        this.writeEmitter.fire(cmd);
        return;
      } else {
        this.writeEmitter.fire('Type \x1b[1my\x1b[0m/\x1b[1mn\x1b[0m/\x1b[1me\x1b[0m\r\n');
        this.writeEmitter.fire('\x1b[36mRun?\x1b[0m [y]es / [n]o / [e]dit: ');
        return;
      }
    }

    // Empty input
    if (input.length === 0) {
      this.showPrompt();
      return;
    }

    // ! prefix — forced shell passthrough
    if (input.startsWith('!')) {
      const cmd = input.slice(1).trim();
      if (cmd.length > 0) {
        this.executeCommand(cmd);
      } else {
        this.showPrompt();
      }
      return;
    }

    // ? — help
    if (input === '?' || input === 'help') {
      this.showHelp();
      return;
    }

    // Classify and dispatch
    const classification = this.classifyInput(input);
    if (classification === 'shell') {
      this.executeCommand(input);
    } else {
      // Natural language — needs AI
      if (!this.commandGenerator) {
        this.writeEmitter.fire('\x1b[33mAI not configured.\x1b[0m Run \x1b[1mSmart Terminal: Set AI API Key\x1b[0m to enable AI features.\r\n');
        this.writeEmitter.fire('Tip: prefix with \x1b[1m!\x1b[0m to run as shell command.\r\n');
        this.showPrompt();
        return;
      }
      this.generateCommand(input);
    }
  }

  private classifyInput(input: string): 'shell' | 'natural_language' {
    // First token is a known command
    const firstToken = input.split(/\s/)[0].toLowerCase();
    if (KNOWN_COMMANDS.has(firstToken)) { return 'shell'; }

    // Contains pipe, redirect, or background operator
    if (/[|><&]/.test(input)) { return 'shell'; }

    // Starts with path execution
    if (input.startsWith('./') || input.startsWith('/')) { return 'shell'; }

    // Variable assignment: FOO=bar
    if (/^[A-Z_]+=/.test(input)) { return 'shell'; }

    // Single word with no spaces and length > 1 (likely a binary name)
    if (!input.includes(' ') && input.length > 1) { return 'shell'; }

    return 'natural_language';
  }

  private async generateCommand(input: string): Promise<void> {
    this.writeEmitter.fire('\x1b[90mThinking...\x1b[0m\r\n');

    const context: CommandContext = {
      cwd: this.cwd,
      platform: process.platform,
      shell: this.shell,
      recentCommands: this.commandHistory.slice(-5),
    };

    try {
      const result = await this.commandGenerator!.generate(input, context);
      this.showConfirmation(result);
    } catch (err: any) {
      this.writeEmitter.fire(`\x1b[31mAI error: ${err.message || String(err)}\x1b[0m\r\n`);
      this.showPrompt();
    }
  }

  private showConfirmation(generated: GeneratedCommand): void {
    if (generated.error) {
      this.writeEmitter.fire(`\x1b[31mAI error: ${generated.error}\x1b[0m\r\n`);
      this.showPrompt();
      return;
    }

    this.writeEmitter.fire('\r\nSuggested command:\r\n');
    this.writeEmitter.fire(`  \x1b[1;32m$ ${generated.command}\x1b[0m\r\n`);
    this.writeEmitter.fire(`  \x1b[2;90m${generated.explanation}\x1b[0m\r\n`);
    if (generated.isDestructive) {
      this.writeEmitter.fire('  \x1b[1;31m[Warning: This command modifies/deletes data]\x1b[0m\r\n');
    }
    this.writeEmitter.fire('\r\n\x1b[36mRun?\x1b[0m [y]es / [n]o / [e]dit: ');

    this.isAwaitingConfirmation = true;
    this.pendingCommand = generated;
  }

  private executeCommand(command: string): void {
    if (this.childProcess) {
      this.writeEmitter.fire('\x1b[33mA command is already running. Press Ctrl+C to cancel it first.\x1b[0m\r\n');
      this.showPrompt();
      return;
    }

    // Intercept built-in commands that don't work through piped spawn (no real PTY)
    if (command.trim() === 'clear' || command.trim() === 'cls') {
      this.writeEmitter.fire('\x1b[2J\x1b[H');
      this.showPrompt();
      return;
    }

    if (command.trim() === 'pwd') {
      this.writeEmitter.fire(`${this.cwd}\r\n`);
      this.commandHistory.push(command);
      if (this.commandHistory.length > 10) { this.commandHistory.shift(); }
      this.showPrompt();
      return;
    }

    // Intercept `cd` — each spawn is a fresh subprocess so cd won't persist otherwise
    const cdMatch = command.match(/^cd(?:\s+(.+))?$/);
    if (cdMatch) {
      const target = (cdMatch[1] || os.homedir()).trim().replace(/^~(?=\/|$)/, os.homedir());
      const resolved = path.resolve(this.cwd, target);
      try {
        if (fs.statSync(resolved).isDirectory()) {
          this.cwd = resolved;
        } else {
          this.writeEmitter.fire(`\x1b[31mcd: not a directory: ${target}\x1b[0m\r\n`);
        }
      } catch {
        this.writeEmitter.fire(`\x1b[31mcd: no such file or directory: ${target}\x1b[0m\r\n`);
      }
      this.commandHistory.push(command);
      if (this.commandHistory.length > 10) { this.commandHistory.shift(); }
      this.showPrompt();
      return;
    }

    // Notify Smart Terminal panel to clear and start fresh for this command
    this.onCommandStart?.();

    // Display the command being run
    this.writeEmitter.fire(`\x1b[90m$ ${command}\x1b[0m\r\n`);

    try {
      const proc = spawn(this.shell, [this.shellFlag, command], {
        cwd: this.cwd,
        env: { ...process.env },
      });
      this.childProcess = proc;

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        this.writeEmitter.fire(text.replace(/\n/g, '\r\n'));
        this.onData?.(text);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        this.writeEmitter.fire(text.replace(/\n/g, '\r\n'));
        this.onData?.(text);
      });

      proc.on('close', (_code) => {
        this.childProcess = null;
        // Store in history (keep last 10)
        this.commandHistory.push(command);
        if (this.commandHistory.length > 10) {
          this.commandHistory.shift();
        }
        this.showPrompt();
      });

      proc.on('error', (err) => {
        this.childProcess = null;
        this.writeEmitter.fire(`\x1b[31mError: ${err.message}\x1b[0m\r\n`);
        this.showPrompt();
      });
    } catch (err: any) {
      this.childProcess = null;
      this.writeEmitter.fire(`\x1b[31mFailed to spawn: ${err.message || String(err)}\x1b[0m\r\n`);
      this.showPrompt();
    }
  }

  private showHelp(): void {
    this.writeEmitter.fire('\r\n\x1b[1mAI Smart Terminal — Help\x1b[0m\r\n');
    this.writeEmitter.fire('  Type a \x1b[1mshell command\x1b[0m (e.g., \x1b[32mls -la\x1b[0m) to execute it directly.\r\n');
    this.writeEmitter.fire('  Type \x1b[1mnatural language\x1b[0m (e.g., \x1b[32mshow me all large files\x1b[0m) for AI translation.\r\n');
    this.writeEmitter.fire('  \x1b[1m!\x1b[0m<cmd>     Force shell passthrough (e.g., \x1b[32m!my-script\x1b[0m)\r\n');
    this.writeEmitter.fire('  \x1b[1m?\x1b[0m          Show this help\r\n');
    this.writeEmitter.fire('  \x1b[1mCtrl+C\x1b[0m     Kill running command or cancel confirmation\r\n');
    this.writeEmitter.fire('  \x1b[1mCtrl+D\x1b[0m     Close terminal (when input is empty)\r\n');
    this.showPrompt();
  }

  private showPrompt(): void {
    const username = os.userInfo().username;
    const hostname = os.hostname().replace(/\.local$/, '');
    const folder = path.basename(this.cwd) || this.cwd;
    this.writeEmitter.fire(
      `\r\n\x1b[32m${username}@${hostname}\x1b[0m \x1b[1;34m${folder}\x1b[0m \x1b[36m(ask ai)\x1b[0m » `
    );
  }

  close(): void {
    if (this.childProcess) {
      this.childProcess.kill('SIGTERM');
      this.childProcess = null;
    }
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}

#!/usr/bin/env bun
/**
 * Agent Bridge - CLI ↔ WebSocket Adapter
 *
 * Wraps CLI tools (claude, gemini, codex) and bridges their stdio
 * to the multi-agent chat room WebSocket server.
 *
 * Usage:
 *   bun rooms/agent-bridge.js --name claude --command "claude --permission-mode acceptEdits"
 *   bun rooms/agent-bridge.js --name gemini --command "gemini --approval-mode auto_edit"
 *   bun rooms/agent-bridge.js --name codex --command "codex --interactive"
 *
 * Environment:
 *   ROOMS_SERVER=ws://localhost:8765/ws (default)
 */

import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import { parse } from 'shell-quote';

// Parse command line args
const args = process.argv.slice(2);
let agentName = 'unknown';
let command = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && i + 1 < args.length) {
    agentName = args[i + 1];
    i++;
  } else if (args[i] === '--command' && i + 1 < args.length) {
    command = args[i + 1];
    i++;
  }
}

if (!command) {
  console.error(`
Usage: bun rooms/agent-bridge.js --name <agent-name> --command "<cli-command>"

Example:
  bun rooms/agent-bridge.js --name claude --command "claude --permission-mode acceptEdits"
  bun rooms/agent-bridge.js --name gemini --command "gemini --approval-mode auto_edit"
`);
  process.exit(1);
}

const SERVER_URL = process.env.ROOMS_SERVER || 'ws://localhost:8765/ws';

console.log(`
🌉 Agent Bridge Starting

  Agent:  ${agentName}
  Command: ${command}
  Server: ${SERVER_URL}
`);

let ws = null;
let agentProcess = null;
let buffer = '';
let debounceTimer = null;
const DEBOUNCE_MS = 100;

/**
 * Connect to WebSocket server
 */
function connectWebSocket() {
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('✅ Connected to room server');

    // Register as agent
    ws.send(JSON.stringify({
      type: 'register',
      name: agentName,
      role: 'agent'
    }));

    // Start CLI process
    startAgentProcess();
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());

    // Forward messages to agent's stdin
    if (message.type === 'agent_prompt') {
      console.log(`📨 Received input from room: ${message.body.substring(0, 50)}...`);

      if (agentProcess && agentProcess.stdin.writable) {
        agentProcess.stdin.write(message.body + '\n');
      }
    } else if (message.type === 'system_notification') {
      console.log(`ℹ️  ${message.body}`);
    }
  });

  ws.on('close', () => {
    console.log('❌ Disconnected from room server - Reconnecting...');
    setTimeout(connectWebSocket, 2000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
}

/**
 * Start the CLI agent process
 */
function startAgentProcess() {
  console.log(`🚀 Starting agent: ${command}`);

  // Parse command using shell-quote for proper handling of quotes and escapes
  const parsed = parse(command);
  const program = parsed[0];
  const args = parsed.slice(1);

  agentProcess = spawn(program, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  });

  // Capture stdout with debounced streaming
  agentProcess.stdout.on('data', (data) => {
    const text = data.toString();
    buffer += text;

    // Clear existing debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Debounce sending to prevent spam from partial tokens
    debounceTimer = setTimeout(() => {
      if (buffer.trim()) {
        sendToRoom(buffer);
        buffer = '';
      }
      debounceTimer = null;
    }, DEBOUNCE_MS);
  });

  // Capture stderr
  agentProcess.stderr.on('data', (data) => {
    const text = data.toString();
    console.error(`[${agentName} stderr]:`, text);

    // Also send errors to room
    sendToRoom(`[ERROR] ${text}`);
  });

  // Handle process exit
  agentProcess.on('exit', (code, signal) => {
    console.log(`Agent exited (code: ${code}, signal: ${signal})`);

    // Flush remaining buffer
    if (buffer.trim()) {
      sendToRoom(buffer);
      buffer = '';
    }

    // Notify room
    sendToRoom(`[Agent ${agentName} terminated]`);

    // Restart after delay
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        startAgentProcess();
      }
    }, 3000);
  });

  agentProcess.on('error', (err) => {
    console.error(`Failed to start agent:`, err);
    sendToRoom(`[Failed to start: ${err.message}]`);
  });

  console.log(`✅ Agent process started (PID: ${agentProcess.pid})`);
}

/**
 * Send message to room
 */
function sendToRoom(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('Not connected to room, buffering...');
    return;
  }

  ws.send(JSON.stringify({
    type: 'agent_output',
    body: text,
    timestamp: new Date().toISOString()
  }));
}

/**
 * Handle process termination
 */
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');

  if (agentProcess) {
    agentProcess.kill();
  }

  if (ws) {
    ws.close();
  }

  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...');

  if (agentProcess) {
    agentProcess.kill();
  }

  if (ws) {
    ws.close();
  }

  process.exit(0);
});

// Start
connectWebSocket();

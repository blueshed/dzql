#!/usr/bin/env bun
/**
 * Multi-Agent Chat Room Server
 *
 * WebSocket hub that coordinates multiple AI agents (Claude, Gemini, Codex)
 * in a shared conversation room with human-in-the-loop message approval.
 *
 * Usage:
 *   bun packages/rooms/server.js
 *
 * Connects to: ws://localhost:8765
 * Web UI at: http://localhost:8765
 */

import { randomUUID } from 'crypto';
import client from "./client.html";

const PORT = process.env.ROOMS_PORT || 8765;
const TRANSCRIPT_PATH = import.meta.dir + '/transcript.jsonl';

// Message types aligned with the protocol specification
const MessageType = {
  AGENT_OUTPUT: 'agent_output',
  AGENT_PROMPT: 'agent_prompt',
  HUMAN_PROMPT: 'human_prompt',
  SYSTEM_NOTIFICATION: 'system_notification',
  HISTORY: 'history'
};

// Connected clients
const agents = new Map(); // WebSocket -> {id, name, type}
const webClients = new Set(); // WebSocket connections from web UI

// Message history
const messageHistory = [];
const MAX_HISTORY = 1000;

/**
 * Broadcast message to all web UI clients
 */
function broadcastToWeb(message) {
  const payload = JSON.stringify(message);
  for (const client of webClients) {
    try {
      client.send(payload);
    } catch (err) {
      console.error('Failed to send to web client:', err);
      webClients.delete(client);
    }
  }
}

/**
 * Send message to specific agent
 */
function sendToAgent(agentId, message) {
  for (const [ws, agent] of agents.entries()) {
    if (agent.id === agentId) {
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.error(`Failed to send to agent ${agentId}:`, err);
        return false;
      }
    }
  }
  return false;
}

/**
 * Load message history from JSONL file
 */
async function loadHistory() {
  try {
    const file = Bun.file(TRANSCRIPT_PATH);
    if (await file.exists()) {
      const text = await file.text();
      const lines = text.trim().split('\n');

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            messageHistory.push(message);
          } catch (err) {
            console.error('Failed to parse message from transcript:', err);
          }
        }
      }

      console.log(`✅ Loaded ${messageHistory.length} messages from transcript`);
    } else {
      console.log('📝 No existing transcript, starting fresh');
    }
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

/**
 * Store message in history and broadcast it
 */
async function recordMessage(message) {
  // Enrich the message with server-side canonical data
  const record = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    metadata: message.metadata || {},
    ...message,
  };

  messageHistory.push(record);

  // Trim history if too long
  if (messageHistory.length > MAX_HISTORY) {
    messageHistory.shift();
  }

  // Append to JSONL file using Bun (non-blocking)
  Bun.write(TRANSCRIPT_PATH, JSON.stringify(record) + '\n', { append: true }).catch(err => {
    console.error('Failed to write to transcript:', err);
  });

  // Broadcast to web UI
  broadcastToWeb(record);
}

/**
 * Handle WebSocket connection
 */
// Load message history from transcript before starting
await loadHistory();

const server = Bun.serve({
  port: PORT,

  routes: {
    "/": client,  // Bun automatically bundles and serves HTML
    "/api/transcript": async () => {
      const file = Bun.file(TRANSCRIPT_PATH);
      return new Response(file, {
        headers: { "Content-Type": "application/x-ndjson" }
      });
    }
  },

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const success = server.upgrade(req);
      return success
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 500 });
    }

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      console.log('New WebSocket connection');

      // Send handshake - client must identify itself
      ws.send(JSON.stringify({
        type: MessageType.SYSTEM_NOTIFICATION,
        body: 'Please identify yourself with {"type": "register", "name": "agent-name", "role": "agent|web"}'
      }));
    },

    message(ws, message) {
      try {
        const data = JSON.parse(message);

        // Handle registration
        if (data.type === 'register') {
          if (data.role === 'agent') {
            const agentId = `${data.name}-${randomUUID().slice(0, 8)}`;
            agents.set(ws, {
              id: agentId,
              name: data.name,
              type: 'agent'
            });

            console.log(`Agent registered: ${data.name} (${agentId})`);

            // Confirm registration
            ws.send(JSON.stringify({
              type: MessageType.SYSTEM_NOTIFICATION,
              body: `Registered as ${agentId}`
            }));

            // Announce to web clients
            recordMessage({
              type: MessageType.SYSTEM_NOTIFICATION,
              source: 'System',
              target: 'all',
              body: `${data.name} joined the room`,
            });

            return;
          } else if (data.role === 'web') {
            webClients.add(ws);
            console.log('Web UI client connected');

            // Send full history to new web client
            ws.send(JSON.stringify({
              type: MessageType.HISTORY,
              messages: messageHistory
            }));

            return;
          }
        }

        // Handle messages from agents
        if (agents.has(ws)) {
          const agent = agents.get(ws);
          recordMessage({
            type: MessageType.AGENT_OUTPUT,
            source: agent.name,
            target: 'PeterB', // Agent output defaults to PeterB
            body: data.body || data.message || data.content,
            metadata: { agentId: agent.id }
          });
          return;
        }

        // Handle messages from web UI (forwarding, human input)
        if (webClients.has(ws)) {
          if (data.type === 'forward') {
            const agentName = agents.get([...agents.keys()].find(k => agents.get(k)?.id === data.targetId))?.name || 'unknown';

            // 1. Create the prompt for the target agent
            const promptMessage = {
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              type: MessageType.AGENT_PROMPT,
              source: 'PeterB',
              target: agentName,
              body: data.body,
              metadata: { original_message_id: data.original_message_id }
            };

            // 2. Send it to the agent
            const success = sendToAgent(data.targetId, promptMessage);

            // 3. Record the forwarding action as a human prompt for the transcript
            if (success) {
              recordMessage({
                type: MessageType.HUMAN_PROMPT,
                source: 'PeterB',
                target: agentName,
                body: data.body,
                metadata: {
                  ...promptMessage.metadata,
                  forwarded_to: data.targetId,
                  comment: `Forwarded from ${data.source}.`
                }
              });
            }
            return;
          }

          if (data.type === 'human_prompt') {
            // PeterB injected message
            recordMessage({
              type: MessageType.HUMAN_PROMPT,
              source: 'PeterB',
              target: data.target || 'all', // Allow targeting specific agents or all
              body: data.body,
            });
            return;
          }
        }

      } catch (err) {
        console.error('Error processing message:', err);
        ws.send(JSON.stringify({
          type: MessageType.SYSTEM_NOTIFICATION,
          body: `Error: ${err.message}`
        }));
      }
    },

    close(ws) {
      if (agents.has(ws)) {
        const agent = agents.get(ws);
        console.log(`Agent disconnected: ${agent.name}`);

        recordMessage({
          type: MessageType.SYSTEM_NOTIFICATION,
          source: 'System',
          target: 'all',
          body: `${agent.name} left the room`,
        });

        agents.delete(ws);
      }

      if (webClients.has(ws)) {
        console.log('Web UI client disconnected');
        webClients.delete(ws);
      }
    }
  }
});

console.log(`
🎭 Multi-Agent Chat Room Server

  WebSocket: ws://localhost:${PORT}/ws
  Web UI:    http://localhost:${PORT}

Waiting for agents to connect...
`);

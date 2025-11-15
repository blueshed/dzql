#!/usr/bin/env bun
/**
 * Claude Agent - Anthropic API ↔ WebSocket Adapter
 *
 * Connects Claude via Anthropic API to the multi-agent chat room.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun packages/rooms/claude-agent.js
 *
 * Environment:
 *   ANTHROPIC_API_KEY - Required: Your Anthropic API key
 *   ROOMS_SERVER - Optional: WebSocket server URL (default: ws://localhost:8765/ws)
 *   CLAUDE_MODEL - Optional: Model to use (default: claude-sonnet-4-5-20250929)
 */

import Anthropic from '@anthropic-ai/sdk';
import { WebSocket } from 'ws';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const SERVER_URL = process.env.ROOMS_SERVER || 'ws://localhost:8765/ws';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

if (!API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  console.error('\nUsage:');
  console.error('  ANTHROPIC_API_KEY=sk-... bun packages/rooms/claude-agent.js');
  process.exit(1);
}

console.log(`
🤖 Claude Agent Starting

  Model:  ${MODEL}
  Server: ${SERVER_URL}
`);

const anthropic = new Anthropic({ apiKey: API_KEY });
let ws = null;
let conversationHistory = [];

/**
 * Connect to WebSocket server
 */
function connectWebSocket() {
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('✅ Connected to room server');

    // Register as Claude agent
    ws.send(JSON.stringify({
      type: 'register',
      name: 'Claude',
      role: 'agent'
    }));
  });

  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());

    // Handle prompts directed at Claude
    if (message.type === 'agent_prompt') {
      console.log(`📨 Received prompt: ${message.body.substring(0, 50)}...`);
      await handlePrompt(message.body);
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
 * Handle incoming prompt from the room
 */
async function handlePrompt(promptText) {
  try {
    // Add user message to history
    conversationHistory.push({
      role: 'user',
      content: promptText
    });

    console.log('🤔 Thinking...');

    // Call Anthropic API with streaming
    const stream = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: conversationHistory,
      stream: true
    });

    let fullResponse = '';
    let buffer = '';
    let lastSendTime = Date.now();
    const DEBOUNCE_MS = 200;

    // Stream the response
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const text = event.delta.text;
        fullResponse += text;
        buffer += text;

        // Debounced sending to room
        const now = Date.now();
        if (now - lastSendTime >= DEBOUNCE_MS) {
          if (buffer) {
            sendToRoom(buffer);
            buffer = '';
            lastSendTime = now;
          }
        }
      }
    }

    // Send any remaining buffered content
    if (buffer) {
      sendToRoom(buffer);
    }

    // Add assistant response to history
    conversationHistory.push({
      role: 'assistant',
      content: fullResponse
    });

    console.log('✅ Response sent');

  } catch (error) {
    console.error('Error calling Anthropic API:', error);
    sendToRoom(`[Error: ${error.message}]`);
  }
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
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

// Start
connectWebSocket();

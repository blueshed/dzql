#!/usr/bin/env bun
/**
 * OpenAI Agent - Chat Completions ↔ WebSocket Bridge
 *
 * Connects an OpenAI chat model (GPT-4o, GPT-4o-mini, etc.) to the
 * multi-agent room. Listens for prompts routed to "OpenAI" and streams
 * responses back to the room UI.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... bun packages/rooms/openai-agent.js
 *
 * Optional environment variables:
 *   ROOMS_SERVER   - WebSocket URL for the hub (default ws://localhost:8765/ws)
 *   OPENAI_MODEL   - Chat model to use (default gpt-4o-mini)
 *   OPENAI_BASE_URL- Override base URL (for Azure/Ollama-compatible proxies)
 */

import { WebSocket } from 'ws';

const SERVER_URL = process.env.ROOMS_SERVER || 'ws://localhost:8765/ws';
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

if (!API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

console.log(`\n🧠 OpenAI Agent Starting\n\n  Model:  ${MODEL}\n  Server: ${SERVER_URL}\n`);

let ws = null;
const conversation = [];

function connectWebSocket() {
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('✅ Connected to room server');
    ws.send(JSON.stringify({
      type: 'register',
      name: 'OpenAI',
      role: 'agent'
    }));
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'agent_prompt' && (message.target === 'OpenAI' || message.target === 'all')) {
        console.log(`📨 Prompt received (${message.body.length} chars)`);
        await handlePrompt(message.body);
      } else if (message.type === 'system_notification') {
        console.log(`ℹ️  ${message.body}`);
      }
    } catch (error) {
      console.error('Failed to process room message:', error);
    }
  });

  ws.on('close', () => {
    console.log('❌ Disconnected from room server - reconnecting…');
    setTimeout(connectWebSocket, 2000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
}

async function handlePrompt(prompt) {
  conversation.push({ role: 'user', content: prompt });

  try {
    const stream = await callOpenAI(conversation);
    let assistantReply = '';

    for await (const chunk of stream) {
      if (chunk) {
        assistantReply += chunk;
        sendToRoom(chunk);
      }
    }

    conversation.push({ role: 'assistant', content: assistantReply });
    console.log('✅ OpenAI response delivered');
  } catch (error) {
    console.error('OpenAI request failed:', error);
    sendToRoom(`[OpenAI error] ${error.message}`);
  }
}

async function* callOpenAI(history) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages: history.map((entry) => ({ role: entry.role, content: entry.content }))
    })
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.replace(/^data:\s*/, '');
      if (payload === '[DONE]') {
        return;
      }

      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') {
          yield delta;
        } else if (Array.isArray(delta)) {
          yield delta.map(part => part.text ?? '').join('');
        }
      } catch (err) {
        console.error('Failed to parse OpenAI stream chunk:', err, payload);
      }
    }
  }
}

function sendToRoom(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('Not connected to room, dropping chunk');
    return;
  }

  ws.send(JSON.stringify({
    type: 'agent_output',
    body: text,
    timestamp: new Date().toISOString()
  }));
}

function shutdown() {
  console.log('\n👋 Shutting down OpenAI agent');
  if (ws) {
    ws.removeAllListeners?.('close');
    ws.close();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

connectWebSocket();

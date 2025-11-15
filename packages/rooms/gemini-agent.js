#!/usr/bin/env bun
/**
 * Gemini Agent - Google AI API ↔ WebSocket Bridge
 *
 * Connects to the multi-agent chat room, listens for prompts,
 * gets responses from the Google AI Gemini API, and sends them back to the room.
 *
 * This replaces the need for a CLI-based agent.
 *
 * Usage:
 *   GOOGLE_API_KEY="your-api-key" bun packages/rooms/gemini-agent.js
 *
 * Environment:
 *   ROOMS_SERVER=ws://localhost:8765 (default)
 *   GOOGLE_API_KEY=your-api-key (required)
 */

import { WebSocket } from 'ws';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Configuration ---
const AGENT_NAME = 'Gemini';
const SERVER_URL = process.env.ROOMS_SERVER || 'ws://localhost:8765';
const API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

if (!API_KEY) {
  console.error('🔴 ERROR: GOOGLE_API_KEY environment variable is not set.');
  process.exit(1);
}

console.log(`
♊️ Gemini Agent Starting

  Agent:  ${AGENT_NAME}
  Model:  ${GEMINI_MODEL}
  Server: ${SERVER_URL}
`);

// --- Google AI Setup ---
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });


// --- WebSocket Connection ---
let ws = null;

function connectWebSocket() {
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('✅ Connected to room server');
    // Register as agent
    ws.send(JSON.stringify({
      type: 'register',
      name: AGENT_NAME,
      role: 'agent'
    }));
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleRoomMessage(message);
    } catch (error) {
      console.error('Error parsing room message:', error);
    }
  });

  ws.on('close', () => {
    console.log('❌ Disconnected from room server - Reconnecting in 5 seconds...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    // The 'close' event will fire, triggering reconnection.
  });
}

/**
 * Handles incoming messages from the room server.
 * @param {object} message The parsed message from the room.
 */
async function handleRoomMessage(message) {
  if (message.type === 'agent_prompt' && (message.target === AGENT_NAME || message.target === 'all')) {
    console.log(`📨 Received prompt: "${message.body.substring(0, 80)}"...`);

    try {
      const responseText = await getGeminiResponse(message.body);
      console.log(`✅ Sending response: "${responseText.substring(0, 80)}"...`);
      sendToRoom({
        type: 'agent_output',
        body: responseText,
      });
    } catch (error) {
      console.error('Error getting response from Gemini:', error);
      sendToRoom({
        type: 'agent_output',
        body: `[ERROR] Failed to get response from Gemini API: ${error.message}`,
      });
    }
  } else if (message.type === 'system_notification') {
    console.log(`ℹ️  [SYSTEM] ${message.body}`);
  }
}

/**
 * Gets a response from the Gemini API for a given prompt.
 * @param {string} prompt The text prompt.
 * @returns {Promise<string>} The response text from the API.
 */
async function getGeminiResponse(prompt) {
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini API Error:', error);
    // Propagate a more informative error
    throw new Error(error.message || 'An unknown error occurred with the Gemini API.');
  }
}

/**
 * Sends a message object to the room server.
 * @param {object} messageData The data to send.
 */
function sendToRoom(messageData) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('Not connected to room, cannot send message.');
    return;
  }
  // The server will add the canonical id, timestamp, source, etc.
  ws.send(JSON.stringify(messageData));
}

// --- Graceful Shutdown ---
function shutdown() {
  console.log('\n👋 Shutting down Gemini agent...');
  if (ws) {
    // Prevent reconnection logic from firing
    ws.removeAllListeners('close');
    ws.close();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Start the agent ---
connectWebSocket();

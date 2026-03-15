#!/usr/bin/env node

/**
 * GuardClaw MCP Server for Claude Desktop / Cowork monitoring.
 * Runs as a stdio MCP server registered in claude_desktop_config.json.
 * Provides a safety-check tool and logs all interactions to GuardClaw.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'http';

const GUARDCLAW_URL = 'http://127.0.0.1:3002';

function postToGuardClaw(path, data) {
  return new Promise((resolve) => {
    const body = JSON.stringify(data);
    const req = http.request(
      `${GUARDCLAW_URL}${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try { resolve(JSON.parse(chunks)); } catch { resolve({ ok: true }); }
        });
      }
    );
    req.on('error', () => resolve({ error: 'guardclaw unreachable' }));
    req.write(body);
    req.end();
  });
}

const server = new Server(
  { name: 'guardclaw', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'guardclaw_safety_check',
      description:
        'Report a planned action to GuardClaw safety monitor for risk assessment before executing it. ' +
        'Call this BEFORE running any potentially risky command (rm, curl, chmod, pip install, etc.) ' +
        'or writing to sensitive files. Returns a risk score and recommendation.',
      inputSchema: {
        type: 'object',
        properties: {
          action_type: {
            type: 'string',
            enum: ['command', 'file_write', 'file_delete', 'web_fetch', 'other'],
            description: 'Type of action being performed',
          },
          description: {
            type: 'string',
            description: 'What you are about to do (e.g. "rm -rf /tmp/build", "write to ~/.bashrc")',
          },
          command: {
            type: 'string',
            description: 'The exact command or file path involved',
          },
        },
        required: ['action_type', 'description'],
      },
    },
    {
      name: 'guardclaw_report',
      description:
        'Report completed actions to GuardClaw for audit logging. ' +
        'Call this after completing significant operations to maintain an audit trail.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'What was done',
          },
          result: {
            type: 'string',
            enum: ['success', 'failure', 'partial'],
            description: 'Outcome of the action',
          },
          details: {
            type: 'string',
            description: 'Additional details or output summary',
          },
        },
        required: ['action', 'result'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'guardclaw_safety_check') {
    const result = await postToGuardClaw('/api/mcp/safety-check', {
      source: 'cowork-mcp',
      actionType: args.action_type,
      description: args.description,
      command: args.command || '',
      timestamp: Date.now(),
    });

    const riskScore = result.riskScore || 1;
    const verdict = riskScore <= 3 ? 'SAFE' : riskScore <= 7 ? 'WARNING' : 'BLOCKED';

    return {
      content: [
        {
          type: 'text',
          text: `GuardClaw Safety Check:\n  Risk Score: ${riskScore}/10\n  Verdict: ${verdict}\n  ${result.reasoning || ''}\n\n${verdict === 'BLOCKED' ? '⚠️ This action is considered high-risk. Do NOT proceed.' : '✓ You may proceed.'}`,
        },
      ],
    };
  }

  if (name === 'guardclaw_report') {
    await postToGuardClaw('/api/mcp/report', {
      source: 'cowork-mcp',
      action: args.action,
      result: args.result,
      details: args.details || '',
      timestamp: Date.now(),
    });

    return {
      content: [{ type: 'text', text: 'Action logged to GuardClaw.' }],
    };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);

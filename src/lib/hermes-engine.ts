// Hermes 3 Agentic Layer - Convert OpenAI tools to Hermes format, agent loop
import { db } from './db';

interface ChatMessage {
  role: string;
  content: string | any[];
  tool_calls?: any[];
  tool_call_id?: string;
}

interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
}

interface AgentStep {
  role: 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

// Convert OpenAI tools format to Hermes 3 special token format
// Hermes 3 uses <|tool_call|>...<|/tool_call|> and <|tool_response|>...<|/tool_response|>
export function toolsToHermesPrompt(tools: Tool[]): string {
  if (!tools || tools.length === 0) return '';

  const toolDefs = tools.map(t => {
    const params = t.function.parameters ? JSON.stringify(t.function.parameters, null, 2) : '{"type": "object", "properties": {}}';
    return `# Tool: ${t.function.name}\n${t.function.description || 'No description'}\nParameters:\n${params}`;
  }).join('\n\n');

  return `<|tools|>\n${toolDefs}\n<|/tools|>`;
}

// Convert a tool_calls response to Hermes format for the conversation
export function toolCallsToHermes(toolCalls: any[]): string {
  return toolCalls.map(tc => {
    const args = tc.function.arguments || '{}';
    return `<|tool_call|>{"name": "${tc.function.name}", "arguments": ${args}}<|/tool_call|>`;
  }).join('\n');
}

// Convert tool response to Hermes format
export function toolResponseToHermes(toolCallId: string, name: string, content: string): string {
  return `<|tool_response|>{"name": "${name}", "content": ${JSON.stringify(content)}}<|/tool_response|>`;
}

// Build the full Hermes-format messages from OpenAI messages
export function buildHermesMessages(messages: ChatMessage[], tools?: Tool[]): ChatMessage[] {
  if (!tools || tools.length === 0) return messages;

  // Insert tool definitions into system message
  const toolPrompt = toolsToHermesPrompt(tools);
  const hermesMessages: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      hermesMessages.push({
        role: 'system',
        content: `${toolPrompt}\n\n${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`,
      });
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      // Convert tool_calls to Hermes format in content
      const textContent = typeof msg.content === 'string' ? msg.content : '';
      const hermesToolCalls = toolCallsToHermes(msg.tool_calls);
      hermesMessages.push({
        role: 'assistant',
        content: textContent ? `${textContent}\n\n${hermesToolCalls}` : hermesToolCalls,
      });
    } else if (msg.role === 'tool') {
      // Convert tool response to Hermes format
      const hermesResp = toolResponseToHermes(msg.tool_call_id || '', msg.name || '', typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      hermesMessages.push({ role: 'user', content: hermesResp });
    } else {
      hermesMessages.push(msg);
    }
  }

  return hermesMessages;
}

// MCP Server integration - simple HTTP-based tool execution
interface McpServerConfig {
  url: string;
  headers?: Record<string, string>;
}

// Execute a tool call via MCP-like protocol
export async function executeToolCall(
  toolName: string,
  toolArgs: Record<string, any>,
  mcpServers?: McpServerConfig[],
): Promise<{ success: boolean; result: string; error?: string }> {
  // Built-in tools that don't need MCP
  if (toolName === 'get_current_time') {
    return { success: true, result: new Date().toISOString() };
  }
  if (toolName === 'calculator') {
    try {
      const expr = toolArgs.expression || '0';
      // Safe evaluation - only allow numbers and basic operators
      const sanitized = expr.replace(/[^0-9+\-*/().% ]/g, '');
      const result = Function(`"use strict"; return (${sanitized})`)();
      return { success: true, result: String(result) };
    } catch (e: any) {
      return { success: false, result: '', error: `Calculation error: ${e.message}` };
    }
  }

  // Try MCP servers
  if (mcpServers && mcpServers.length > 0) {
    for (const server of mcpServers) {
      try {
        const resp = await fetch(`${server.url}/tools/${toolName}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...server.headers },
          body: JSON.stringify({ arguments: toolArgs }),
        });
        if (resp.ok) {
          const data = await resp.json();
          return { success: true, result: JSON.stringify(data) };
        }
      } catch (e: any) {
        console.error(`MCP server ${server.url} failed for ${toolName}:`, e.message);
      }
    }
  }

  return { success: false, result: '', error: `No MCP server available for tool: ${toolName}` };
}

// Agent loop - run tool calls until final answer
export interface AgentLoopOptions {
  maxIterations: number;
  model: string;
  messages: ChatMessage[];
  tools: Tool[];
  providerApiKey?: string;
  allowedProviderIds?: string[];
  mcpServers?: McpServerConfig[];
}

export async function agentLoop(
  callProvider: (messages: ChatMessage[], model: string, tools?: Tool[]) => Promise<any>,
  options: AgentLoopOptions,
): Promise<{ finalMessage: any; steps: AgentStep[]; totalToolCalls: number }> {
  const { maxIterations, model, messages, tools, mcpServers } = options;
  let currentMessages = [...messages];
  const steps: AgentStep[] = [];
  let totalToolCalls = 0;

  for (let i = 0; i < maxIterations; i++) {
    // Call the LLM
    const response = await callProvider(currentMessages, model, tools);
    const choice = response.choices?.[0];
    if (!choice) throw new Error('No response from provider');

    const assistantMsg = choice.message;
    steps.push({ role: 'assistant', content: typeof assistantMsg.content === 'string' ? assistantMsg.content : JSON.stringify(assistantMsg.content) });
    currentMessages.push(assistantMsg);

    // If no tool calls, we're done
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      return { finalMessage: response, steps, totalToolCalls };
    }

    // Execute each tool call
    for (const tc of assistantMsg.tool_calls) {
      totalToolCalls++;
      const args = JSON.parse(tc.function.arguments || '{}');
      const toolResult = await executeToolCall(tc.function.name, args, mcpServers);

      const toolMsg: AgentStep = {
        role: 'tool',
        content: toolResult.success ? toolResult.result : `Error: ${toolResult.error}`,
        tool_call_id: tc.id,
        name: tc.function.name,
      };
      steps.push(toolMsg);
      currentMessages.push(toolMsg as any);
    }
  }

  // Max iterations reached
  return {
    finalMessage: {
      choices: [{ message: { role: 'assistant', content: 'Agent loop reached maximum iterations.' }, finish_reason: 'stop' }],
    },
    steps,
    totalToolCalls,
  };
}

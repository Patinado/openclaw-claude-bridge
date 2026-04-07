'use strict';

// Gateway-internal tools that should not be listed as available to Claude.
// These are OC infrastructure tools, not user-facing.
const GATEWAY_BLOCKED = new Set(['sessions_send', 'sessions_spawn', 'gateway']);

/**
 * Tool profile filtering (opt-in).
 * Set env TOOL_PROFILE_MODE=auto to enable profile-based tool selection.
 * When enabled, only frequently-used tools are included in the system prompt,
 * reducing token overhead by ~3-5KB per request.
 *
 * Profiles:
 * - core: tools used in >95% of requests (exec, process, read, edit, write, message)
 * - search: web_search, memory_search, exa_search
 * - all: everything (same as TOOL_PROFILE_MODE=off)
 *
 * When auto: includes core + search + any tool that appeared in conversation history.
 */
const TOOL_PROFILE_MODE = process.env.TOOL_PROFILE_MODE || 'off';
const CORE_TOOLS = new Set(['exec', 'process', 'read', 'edit', 'write', 'message', 'memory_search', 'web_search']);

function filterToolsByProfile(tools, messages) {
    if (TOOL_PROFILE_MODE === 'off') return tools;

    // In auto mode: core tools + any tool already referenced in conversation
    const usedTools = new Set();
    for (const msg of messages) {
        if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
                usedTools.add(tc.function?.name || tc.name);
            }
        }
        if (msg.role === 'tool' && msg.name) {
            usedTools.add(msg.name);
        }
    }

    return tools.filter(t => {
        const name = t.function?.name || t.name;
        return CORE_TOOLS.has(name) || usedTools.has(name);
    });
}

/**
 * Build tool instructions for the system prompt.
 *
 * In the new architecture, Claude does NOT execute tools.
 * Instead, it outputs <tool_call> blocks which we parse and return
 * to OpenClaw as standard OpenAI tool_calls.
 * OpenClaw executes the tools and sends results back.
 */
function buildToolInstructions(tools) {
    if (!tools || tools.length === 0) return '';

    const lines = [
        '',
        '---',
        '',
        '## Tool Calling Protocol',
        '',
        'When you need to use a tool, output EXACTLY this format and then STOP:',
        '',
        '<tool_call>',
        '{"name": "tool_name", "arguments": {"key": "value"}}',
        '</tool_call>',
        '',
        'You may request multiple tools at once:',
        '',
        '<tool_call>',
        '{"name": "web_search", "arguments": {"query": "bitcoin price"}}',
        '</tool_call>',
        '<tool_call>',
        '{"name": "memory_search", "arguments": {"query": "user preferences"}}',
        '</tool_call>',
        '',
        'CRITICAL RULES:',
        '- Do NOT execute tools yourself. Do NOT use Bash, Read, Write, Edit, WebSearch, WebFetch, Glob, Grep, or any native tools.',
        '- Output <tool_call> blocks and STOP. The orchestrator will execute them and provide results.',
        '- If you do not need any tools, just respond with your answer directly.',
        '- The conversation may already contain tool results from previous turns — use them, do not re-request.',
        '',
        'Available tools:',
    ];

    for (const tool of tools) {
        const name = tool.function?.name || tool.name;
        if (!name) continue;
        if (GATEWAY_BLOCKED.has(name)) continue;
        const desc = tool.function?.description || tool.description || '';
        lines.push(`- **${name}**: ${desc}`);
    }

    return lines.join('\n');
}

module.exports = { buildToolInstructions, filterToolsByProfile };

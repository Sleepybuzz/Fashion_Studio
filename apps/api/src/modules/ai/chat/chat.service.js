import { PROVIDER_ERROR as E, ProviderError } from '../providers/errors.js';
import { buildSystemPrompt, parseRawInstruction, validateInstruction, cleanText } from './instruction.js';

/**
 * Chat AI service: provider-independent orchestration of "customer message -> validated instruction".
 * It never touches the database or the image provider; callers decide what to do with the validated result.
 * @param {{getChatProvider: () => import('../providers/chat/chat-provider.contract.js').ChatProvider}} deps
 */
export function createChatService({ getChatProvider }) {
  return {
    /**
     * @param {object} p
     * @param {{role:'user'|'assistant', text:string}[]} p.history  prior turns (oldest first), WITHOUT the new message
     * @param {string} p.message  the customer's new message
     * @param {object} p.context  see buildSystemPrompt (+ imageAvailable)
     * @returns {Promise<{instruction: import('./instruction.js').ValidatedInstruction, intent:string, model:string, provider:string}>}
     */
    async understand({ history, message, context }) {
      const provider = getChatProvider();
      if (!provider.isConfigured()) throw new ProviderError(E.NOT_CONFIGURED, { providerCode: 'NO_LOCAL_CONFIG' });
      const system = buildSystemPrompt(context);
      const messages = [...history, { role: 'user', text: cleanText(message, 2000) }];
      const { data, model } = await provider.understandInstruction({ system, messages, temperature: 0.2, maxOutputTokens: 800 });
      const parsed = parseRawInstruction(data);
      if (!parsed) throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'UNEXPECTED_SHAPE' });
      const instruction = validateInstruction(parsed, {
        message, visibleView: context.visibleView, has3d: context.has3d, options: context.options || [], imageAvailable: context.imageAvailable,
      });
      return { instruction, intent: parsed.intent, model, provider: provider.id };
    },
  };
}

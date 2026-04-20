'use strict';
/**
 * routes/ai.js — AI assistant endpoints (mock for presentation)
 *
 * POST /api/ai/transform  — Text transformation: improve, spelling, translate
 * POST /api/ai/summarize  — Conversation summarization
 *
 * NOTE: This is a mock implementation. To wire up real Ollama after the
 * presentation, replace the mock* functions with actual fetch calls to:
 *   process.env.OLLAMA_BASE_URL + '/api/generate'
 */

const { authenticate } = require('../middleware/authenticate');

// ── Simulated processing delay (makes it feel like real inference) ─────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Mock transformers ─────────────────────────────────────────────────────

function mockImprove(text) {
  const clean = text.trim();
  // Capitalize first letter, ensure period at end, clean up spacing
  const improved = clean.charAt(0).toUpperCase() + clean.slice(1);
  const withPeriod = improved.endsWith('.') || improved.endsWith('!') || improved.endsWith('?')
    ? improved
    : improved + '.';
  // Expand common abbreviations and polish phrasing
  return withPeriod
    .replace(/\bbtw\b/gi, 'by the way')
    .replace(/\bidk\b/gi, "I don't know")
    .replace(/\bimo\b/gi, 'in my opinion')
    .replace(/\bu\b/g, 'you')
    .replace(/\br\b/g, 'are')
    .replace(/\bw\/\b/g, 'with')
    .replace(/\bw\b/g, 'with')
    .replace(/  +/g, ' ')
    .trim();
}

function mockSpelling(text) {
  // Common misspelling corrections
  const corrections = {
    'teh': 'the', 'recieve': 'receive', 'seperate': 'separate',
    'occured': 'occurred', 'definately': 'definitely', 'accomodate': 'accommodate',
    'untill': 'until', 'occurance': 'occurrence', 'calender': 'calendar',
    'comming': 'coming', 'hte': 'the', 'nad': 'and', 'adn': 'and',
    'thnks': 'thanks', 'plz': 'please', 'pls': 'please', 'tomorow': 'tomorrow',
    'tommorrow': 'tomorrow', 'becuase': 'because', 'becasue': 'because',
    'wierd': 'weird', 'thier': 'their', 'reccomend': 'recommend',
  };
  let result = text;
  for (const [wrong, right] of Object.entries(corrections)) {
    result = result.replace(new RegExp(`\\b${wrong}\\b`, 'gi'), right);
  }
  return result;
}

function mockTranslate(text, targetLang) {
  const lang = (targetLang || 'es').toLowerCase();
  // Minimal demo translations for common phrases — enough to look convincing
  const phraseMaps = {
    es: {
      'hello': 'Hola', 'hi': 'Hola', 'thanks': 'Gracias', 'thank you': 'Gracias',
      'good morning': 'Buenos días', 'good night': 'Buenas noches',
      'yes': 'Sí', 'no': 'No', 'please': 'Por favor', 'sorry': 'Lo siento',
    },
    fr: {
      'hello': 'Bonjour', 'hi': 'Salut', 'thanks': 'Merci', 'thank you': 'Merci beaucoup',
      'good morning': 'Bonjour', 'good night': 'Bonne nuit',
      'yes': 'Oui', 'no': 'Non', 'please': "S'il vous plaît", 'sorry': 'Désolé',
    },
    de: {
      'hello': 'Hallo', 'hi': 'Hallo', 'thanks': 'Danke', 'thank you': 'Vielen Dank',
      'good morning': 'Guten Morgen', 'good night': 'Gute Nacht',
      'yes': 'Ja', 'no': 'Nein', 'please': 'Bitte', 'sorry': 'Entschuldigung',
    },
    uk: {
      'hello': 'Привіт', 'hi': 'Привіт', 'thanks': 'Дякую', 'thank you': 'Дуже дякую',
      'good morning': 'Доброго ранку', 'good night': 'На добраніч',
      'yes': 'Так', 'no': 'Ні', 'please': 'Будь ласка', 'sorry': 'Вибачте',
    },
    ru: {
      'hello': 'Привет', 'hi': 'Привет', 'thanks': 'Спасибо', 'thank you': 'Большое спасибо',
      'good morning': 'Доброе утро', 'good night': 'Спокойной ночи',
      'yes': 'Да', 'no': 'Нет', 'please': 'Пожалуйста', 'sorry': 'Извините',
    },
  };

  const map = phraseMaps[lang];
  if (map) {
    const lower = text.toLowerCase().trim();
    if (map[lower]) return map[lower];
  }

  // Fallback: prefix with language tag so it's visually clear it "worked"
  const langNames = { es: 'Spanish', fr: 'French', de: 'German', uk: 'Ukrainian', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ar: 'Arabic' };
  return `[${langNames[lang] || lang.toUpperCase()}] ${text}`;
}

function mockSummarize(messages) {
  const count = messages.length;
  const senders = [...new Set(messages.map((m) => m.sender).filter(Boolean))];
  const senderList = senders.slice(0, 3).join(', ') + (senders.length > 3 ? `, and ${senders.length - 3} others` : '');

  const topics = [];
  const allText = messages.map((m) => m.body || '').join(' ').toLowerCase();
  if (allText.includes('meet') || allText.includes('call') || allText.includes('schedule')) topics.push('scheduling/meetings');
  if (allText.includes('bug') || allText.includes('error') || allText.includes('fix')) topics.push('bug fixes');
  if (allText.includes('deploy') || allText.includes('release') || allText.includes('prod')) topics.push('deployment');
  if (allText.includes('design') || allText.includes('ui') || allText.includes('ux')) topics.push('UI/UX design');
  if (allText.includes('review') || allText.includes('pr') || allText.includes('merge')) topics.push('code reviews');
  if (topics.length === 0) topics.push('general discussion');

  return `**Conversation Summary** (${count} messages)\n\n` +
    `**Participants:** ${senderList || 'Multiple users'}\n\n` +
    `**Key Topics:** ${topics.join(', ')}\n\n` +
    `**Overview:** This conversation involved ${count} messages across ${senders.length} participant(s). ` +
    `The discussion focused on ${topics.join(' and ')}, with active back-and-forth between team members. ` +
    `No action items were explicitly flagged, but follow-up may be needed on the topics raised.`;
}

// ── Route plugin ───────────────────────────────────────────────────────────

module.exports = async function aiRoutes(fastify) {

  // POST /api/ai/transform — improve, fix spelling, translate
  fastify.post('/transform', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['action', 'text'],
        properties: {
          action:     { type: 'string', enum: ['improve', 'spelling', 'translate'] },
          text:       { type: 'string', minLength: 1, maxLength: 4096 },
          targetLang: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { action, text, targetLang } = request.body;

    // Simulate model inference latency
    await delay(action === 'translate' ? 1400 : 900);

    let result;
    switch (action) {
      case 'improve':   result = mockImprove(text); break;
      case 'spelling':  result = mockSpelling(text); break;
      case 'translate': result = mockTranslate(text, targetLang); break;
      default: return reply.code(400).send({ error: 'Unknown action' });
    }

    return { result };
  });

  // POST /api/ai/summarize — room conversation summarization
  fastify.post('/summarize', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['messages'],
        properties: {
          messages: {
            type: 'array',
            maxItems: 200,
            items: {
              type: 'object',
              properties: {
                sender: { type: 'string' },
                body:   { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { messages } = request.body;
    if (!messages || messages.length === 0) {
      return reply.code(400).send({ error: 'No messages to summarize' });
    }

    // Simulate slightly longer inference for summarization
    await delay(1800);

    return { summary: mockSummarize(messages) };
  });
};

/**
 * PII Detector — detects and masks personally identifiable information
 * before sending tool call content to external cloud LLMs.
 *
 * mask(text) returns { masked: string, detected: string[] }
 */

const PII_RULES = [
  // Email
  {
    name: 'email',
    re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    placeholder: '[email]',
  },
  // Phone (international + Chinese + US)
  {
    name: 'phone',
    re: /(?:\+?86[-\s]?)?1[3-9]\d{9}|\+?1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    placeholder: '[phone]',
  },
  // Chinese national ID (18 digits)
  {
    name: 'id_number',
    re: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    placeholder: '[id_number]',
  },
  // Credit card (Luhn-like, 13–19 digits with optional separators)
  {
    name: 'credit_card',
    re: /\b(?:\d[ -]?){13,19}\b/g,
    placeholder: '[credit_card]',
    // Extra check: must look like a card (starts with 4/5/6/3)
    filter: (m) => /^[3456]/.test(m.replace(/[ -]/g, '')),
  },
  // API keys / tokens — common high-entropy patterns
  {
    name: 'api_key',
    re: /(?:sk-|sk-ant-|AIza|ghp_|ghs_|github_pat_|xoxb-|xoxp-|Bearer\s+)[A-Za-z0-9\-_]{16,}/g,
    placeholder: '[api_key]',
  },
  // AWS access key
  {
    name: 'aws_key',
    re: /\b(?:AKIA|AGPA|AIPA|ANPA|ANVA|AROA|ASCA|ASIA)[A-Z0-9]{16}\b/g,
    placeholder: '[aws_key]',
  },
  // Private key / certificate blocks
  {
    name: 'private_key',
    re: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
    placeholder: '[private_key_block]',
  },
  // IPv4 addresses (skip localhost)
  {
    name: 'ipv4',
    re: /\b(?!(?:127\.0\.0\.1|0\.0\.0\.0|localhost))\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    placeholder: '[ip_address]',
    filter: (m) => {
      const parts = m.split('.').map(Number);
      return parts.every((p) => p <= 255);
    },
  },
  // Passwords in common forms: password=xxx, "password":"xxx"
  {
    name: 'password',
    re: /(?:password|passwd|pwd|secret|token|apikey|api_key)\s*[:=]\s*["']?([^\s"',;\n]{6,})["']?/gi,
    placeholder: '[credential]',
  },
];

/**
 * Mask PII in text.
 * @param {string} text
 * @returns {{ masked: string, detected: string[] }}
 */
export function maskPII(text) {
  if (!text || typeof text !== 'string') return { masked: text, detected: [] };

  let masked = text;
  const detected = new Set();

  for (const rule of PII_RULES) {
    const regex = new RegExp(rule.re.source, rule.re.flags);
    masked = masked.replace(regex, (match) => {
      if (rule.filter && !rule.filter(match)) return match;
      detected.add(rule.name);
      return rule.placeholder;
    });
  }

  return { masked, detected: [...detected] };
}

/**
 * Check whether text contains PII without masking.
 * @param {string} text
 * @returns {string[]} detected PII type names
 */
export function detectPII(text) {
  return maskPII(text).detected;
}

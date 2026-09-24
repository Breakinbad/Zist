const crypto = require('crypto');

function json(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return json(res, 405, { error: `Method must be ${allowed.join(' or ')}.` });
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

function answerValue(answer) {
  if (answer && typeof answer === 'object' && !Array.isArray(answer) && 'value' in answer) {
    return answer.value;
  }
  return answer;
}

function multiValues(answer) {
  if (Array.isArray(answer)) return answer;
  if (answer && typeof answer === 'object' && Array.isArray(answer.values)) return answer.values;
  return [];
}

function optionFor(question, answer) {
  const value = answerValue(answer);
  const options = Array.isArray(question.options) ? question.options : [];
  return options.find((option) => option.value === value) || null;
}

function isVisible(question, answers) {
  if (!question.display_if) return true;
  const { question_key, equals, in: inValues } = question.display_if;
  const current = answerValue(answers[question_key]);
  if (Array.isArray(inValues)) return inValues.includes(current);
  return current === equals;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

module.exports = {
  json,
  methodNotAllowed,
  isUuid,
  normalizeEmail,
  validEmail,
  safeEqual,
  answerValue,
  multiValues,
  optionFor,
  isVisible,
  escapeHtml,
};

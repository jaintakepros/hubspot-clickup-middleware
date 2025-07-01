function extractPlainTextFromDelta(delta) {
  try {
    if (typeof delta === 'string') {
      delta = JSON.parse(delta);
    }

    if (!delta.ops || !Array.isArray(delta.ops)) {
      return '';
    }

    return delta.ops.map(op => op.insert || '').join('');
  } catch (err) {
    console.warn('⚠️ Could not parse delta:', delta);
    return typeof delta === 'string' ? delta : '';
  }
}

module.exports = {
  cleanQuillDelta: extractPlainTextFromDelta
};

function isLikelyDelta(obj) {
  return obj && typeof obj === 'object' && Array.isArray(obj.ops);
}

function isFathomClipContent(delta) {
  if (!isLikelyDelta(delta)) return false;
  return delta.ops.some(op =>
    typeof op.insert === 'string' &&
    op.insert.includes('WATCH FATHOM CLIP') &&
    op.attributes?.link?.includes('fathom.video')
  );
}

function buildFathomDelta(url) {
  return {
    ops: [
      {
        insert: 'WATCH FATHOM CLIP',
        attributes: { link: url }
      },
      { insert: '\n' }
    ]
  };
}

function deltaToFathomHTML(delta) {
  const fathomOp = delta.ops.find(op =>
    op.insert?.includes('WATCH FATHOM CLIP') && op.attributes?.link?.includes('fathom.video')
  );
  if (!fathomOp) return null;

  const href = fathomOp.attributes.link;
  return `<a href="${href}" target="_blank" style="font-size: 18.5px;">WATCH FATHOM CLIP</a>`;
}

module.exports = {
  isLikelyDelta,
  isFathomClipContent,
  buildFathomDelta,
  deltaToFathomHTML
};

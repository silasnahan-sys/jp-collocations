// _tmp_pipeline/detect.mjs
// Input-format auto-detection. Reads the first ~50 lines and classifies as:
//   'vtt'    — WebVTT with timestamps
//   'srt'    — SubRip
//   'tagged' — speaker-tagged plain text ("A: ...", "K: ...")
//   'plain'  — plain text, one sentence/line or sentences mixed
// Robust to BOM and CRLF.

/**
 * @param {string} raw
 * @returns {{format:'vtt'|'srt'|'tagged'|'plain', confidence:number, reason:string}}
 */
export function detectFormat(raw) {
  const head = String(raw ?? '').replace(/^\uFEFF/, '').slice(0, 4000);
  const lines = head.split(/\r?\n/).slice(0, 60);

  if (/^WEBVTT/m.test(head)) {
    return { format: 'vtt', confidence: 0.99, reason: 'WEBVTT header found' };
  }

  // SRT: numeric index lines followed by HH:MM:SS,mmm --> HH:MM:SS,mmm
  const srtArrows = lines.filter(l => /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(l)).length;
  if (srtArrows >= 2) {
    return { format: 'srt', confidence: 0.9, reason: `${srtArrows} SRT timing arrows` };
  }

  // VTT without header (rare but happens — strip-mined files)
  const vttArrows = lines.filter(l => /^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/.test(l)).length;
  if (vttArrows >= 2) {
    return { format: 'vtt', confidence: 0.85, reason: `${vttArrows} VTT timing arrows (no WEBVTT header)` };
  }

  // Tagged: many lines start with single-letter/short-label followed by ":"
  const taggedLines = lines.filter(l => /^[A-Za-z\u4E00-\u9FFFぁ-んァ-ヴ][A-Za-z\u4E00-\u9FFFぁ-んァ-ヴ]{0,4}:\s/.test(l)).length;
  if (taggedLines >= 3 && taggedLines / Math.max(lines.filter(l => l.trim()).length, 1) > 0.4) {
    return { format: 'tagged', confidence: 0.85, reason: `${taggedLines} speaker-tagged lines` };
  }

  // Captions: YouTube "show transcript" / copied caption blocks — lines begin
  // with an inline [MM:SS] or [HH:MM:SS] stamp (optionally a markdown link),
  // body is punctuation-poor. Not SRT/VTT (no --> arrows).
  const capLines = lines.filter(l => /^\[\d{1,2}:\d{2}(?::\d{2})?\]/.test(l)).length;
  if (capLines >= 3) {
    return { format: 'captions', confidence: 0.8, reason: `${capLines} inline-timestamp caption lines` };
  }

  return { format: 'plain', confidence: 0.6, reason: 'no timing/tags detected → plain text' };
}

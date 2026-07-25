/**
 * XTransactionId.ts — generates X's `x-client-transaction-id` request header.
 *
 * As of 2025 X gates its internal GraphQL endpoints (SearchTimeline etc.) behind
 * a per-request signature. A cookie-only client that omits it gets HTTP 404 even
 * with a valid queryId + cookies (see memory: x-search-blocked-transaction-id).
 *
 * This is a faithful port of the reference algorithm
 * (github.com/Lqm1/x-client-transaction-id, itself a port of
 * iSarabjitDhiman/XClientTransaction). Every constant and every step is
 * reproduced exactly; golden/x-transaction.mjs verifies byte-identical output
 * against the reference on a frozen X home fixture.
 *
 * The signature is derived from data X bakes into its web app shell:
 *   - a base64 "site verification" key  (<meta name=twitter-site-verification>)
 *   - byte indices parsed from the `ondemand.s.*.js` webpack chunk
 *   - an animation curve encoded in a hidden `#loading-x-anim-*` SVG path
 * combined with the HTTP method+path, a timestamp, a keyword salt, SHA-256,
 * and an XOR mask. All pure computation → mobile-safe (no Node builtins):
 * DOMParser, crypto.subtle, TextEncoder, plus hand-rolled base64.
 */

// ── constants (verbatim from the reference) ─────────────────────────────
const ADDITIONAL_RANDOM_NUMBER = 3;
const DEFAULT_KEYWORD = 'obfiowerehiring';
const EPOCH_OFFSET_SEC = 1682924400; // X's custom epoch (2023-05-01T07:00:00Z)
const ON_DEMAND_CHUNK_NAME = 'ondemand.s';

const INDICES_REGEX = /\(\w\[(\d{1,2})\],\s*16\)/g;
const ON_DEMAND_FILE_HASH_REGEX =
  /(\d+):\s*["']ondemand\.s["'][\s\S]*?\}\)\[e\]\s*\|\|\s*e\)\s*\+\s*["']\.["']\s*\+\s*\(\{[\s\S]*?\b\1:\s*["']([a-zA-Z0-9_-]+)["']/s;
// Looser fallback: `ondemand.s:"<hash>"` chunk-map form, or a direct file ref.
const ON_DEMAND_FALLBACK_REGEXES = [
  /["']ondemand\.s["']\s*:\s*["']([a-zA-Z0-9_-]+)["']/,
  /ondemand\.s\.([a-f0-9]+)a?\.js/,
];

export interface TxnDeps {
  /** Fetch a URL as text (Obsidian `requestUrl` in prod; node fetch in tests). */
  fetchText(url: string): Promise<string>;
  /** Parse HTML to a DOM Document (DOMParser in prod; linkedom in tests). */
  parseHtml(html: string): Document;
}

// ── small pure helpers (ported exactly) ─────────────────────────────────

/** -1.0 if odd, else 0.0. */
function isOdd(n: number): number {
  return n % 2 ? -1.0 : 0.0;
}

/** Float → hex string (X's exact loop, quirks preserved). */
function floatToHex(x: number): string {
  const result: string[] = [];
  let quotient = Math.floor(x);
  const fraction = x - quotient;

  while (quotient > 0) {
    quotient = Math.floor(x / 16);
    const remainder = Math.floor(x - quotient * 16);
    result.unshift(remainder > 9 ? String.fromCharCode(remainder + 55) : remainder.toString());
    x = quotient;
  }

  if (fraction === 0) return result.join('');
  result.push('.');
  let frac = fraction;
  while (frac > 0) {
    frac *= 16;
    const integer = Math.floor(frac);
    frac -= integer;
    result.push(integer > 9 ? String.fromCharCode(integer + 55) : integer.toString());
  }
  return result.join('');
}

/** rotation° → 2×2 matrix [a,b,c,d]. */
function convertRotationToMatrix(rotation: number): number[] {
  const rad = (rotation * Math.PI) / 180;
  return [Math.cos(rad), -Math.sin(rad), Math.sin(rad), Math.cos(rad)];
}

function interpolate(fromList: number[], toList: number[], f: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < fromList.length; i++) {
    out.push(fromList[i] * (1 - f) + toList[i] * f);
  }
  return out;
}

/** Cubic-bezier easing solver (X's binary-search form). */
function cubicValue(curves: number[], time: number): number {
  const calc = (a: number, b: number, m: number) =>
    3.0 * a * (1 - m) * (1 - m) * m + 3.0 * b * (1 - m) * m * m + m * m * m;

  let startGradient = 0;
  let endGradient = 0;
  let start = 0.0;
  let mid = 0.0;
  let end = 1.0;

  if (time <= 0.0) {
    if (curves[0] > 0.0) startGradient = curves[1] / curves[0];
    else if (curves[1] === 0.0 && curves[2] > 0.0) startGradient = curves[3] / curves[2];
    return startGradient * time;
  }
  if (time >= 1.0) {
    if (curves[2] < 1.0) endGradient = (curves[3] - 1.0) / (curves[2] - 1.0);
    else if (curves[2] === 1.0 && curves[0] < 1.0) endGradient = (curves[1] - 1.0) / (curves[0] - 1.0);
    return 1.0 + endGradient * (time - 1.0);
  }

  while (start < end) {
    mid = (start + end) / 2;
    const xEst = calc(curves[0], curves[2], mid);
    if (Math.abs(time - xEst) < 0.00001) return calc(curves[1], curves[3], mid);
    if (xEst < time) start = mid;
    else end = mid;
  }
  return calc(curves[1], curves[3], mid);
}

function solve(value: number, minVal: number, maxVal: number, rounding: boolean): number {
  const result = (value * (maxVal - minVal)) / 255 + minVal;
  return rounding ? Math.floor(result) : Math.round(result * 100) / 100;
}

/** frame row → animation-key hex string. */
function animate(frames: number[], targetTime: number): string {
  const fromColor = frames.slice(0, 3).concat(1).map(Number);
  const toColor = frames.slice(3, 6).concat(1).map(Number);
  const fromRotation = [0.0];
  const toRotation = [solve(frames[6], 60.0, 360.0, true)];

  const curves = frames.slice(7).map((item, counter) => solve(item, isOdd(counter), 1.0, false));

  const val = cubicValue(curves, targetTime);
  const color = interpolate(fromColor, toColor, val).map((v) => (v > 0 ? v : 0));
  const rotation = interpolate(fromRotation, toRotation, val);
  const matrix = convertRotationToMatrix(rotation[0]);

  const strArr: string[] = color.slice(0, -1).map((v) => Math.round(v).toString(16));
  for (const v of matrix) {
    let rounded = Math.round(v * 100) / 100;
    if (rounded < 0) rounded = -rounded;
    const hexValue = floatToHex(rounded);
    strArr.push(hexValue.startsWith('.') ? `0${hexValue}`.toLowerCase() : hexValue || '0');
  }
  strArr.push('0', '0');
  return strArr.join('').replace(/[.-]/g, '');
}

// ── base64 (hand-rolled; avoids atob/btoa/Buffer env branching) ─────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes: number[] | Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] & 0xff;
    const b1 = i + 1 < bytes.length ? bytes[i + 1] & 0xff : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] & 0xff : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

function base64Decode(s: string): number[] {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = B64.indexOf(clean[i]);
    const n1 = B64.indexOf(clean[i + 1]);
    const n2 = B64.indexOf(clean[i + 2]);
    const n3 = B64.indexOf(clean[i + 3]);
    out.push((n0 << 2) | (n1 >> 4));
    if (n2 >= 0 && i + 2 < clean.length) out.push(((n1 & 15) << 4) | (n2 >> 2));
    if (n3 >= 0 && i + 3 < clean.length) out.push(((n2 & 3) << 6) | n3);
  }
  return out;
}

async function sha256Bytes(data: string): Promise<number[]> {
  const buf = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest));
}

// ── the generator ───────────────────────────────────────────────────────

export class XTransactionGenerator {
  private key: string;
  private keyBytes: number[];
  private animationKey: string;

  private constructor(key: string, keyBytes: number[], animationKey: string) {
    this.key = key;
    this.keyBytes = keyBytes;
    this.animationKey = animationKey;
  }

  /** Fetch X's shell + ondemand chunk, derive the static signing material. */
  static async create(deps: TxnDeps): Promise<XTransactionGenerator> {
    const html = await deps.fetchText('https://x.com/home');
    if (!html || html.length < 1000) {
      throw new Error('x-client-transaction-id: X home shell was empty/blocked.');
    }
    const doc = deps.parseHtml(html);

    const keyEl = doc.querySelector("[name='twitter-site-verification']");
    const key = keyEl?.getAttribute('content') ?? '';
    if (!key) throw new Error('x-client-transaction-id: site-verification key not found in X shell.');
    const keyBytes = base64Decode(key);

    const ondemandUrl = resolveOnDemandUrl(html);
    if (!ondemandUrl) throw new Error('x-client-transaction-id: could not resolve the ondemand.s chunk URL.');
    const ondemandJs = await deps.fetchText(ondemandUrl);
    const indices = extractIndices(ondemandJs);
    if (indices.length < 2) throw new Error('x-client-transaction-id: no key-byte indices in ondemand chunk.');
    const rowIndex = indices[0];
    const keyByteIndices = indices.slice(1);

    const animationKey = computeAnimationKey(doc, keyBytes, rowIndex, keyByteIndices);
    return new XTransactionGenerator(key, keyBytes, animationKey);
  }

  /**
   * Build the header value for one request.
   * @param method e.g. 'GET'
   * @param path   endpoint path WITHOUT query string, e.g.
   *               '/i/api/graphql/<queryId>/SearchTimeline'
   * @param timeNow    injectable for tests (seconds since X epoch)
   * @param randomByte injectable for tests (0..255)
   */
  async generate(method: string, path: string, timeNow?: number, randomByte?: number): Promise<string> {
    const t = timeNow ?? Math.floor((Date.now() - EPOCH_OFFSET_SEC * 1000) / 1000);
    const timeBytes = [t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >> 24) & 0xff];

    const data = `${method}!${path}!${t}${DEFAULT_KEYWORD}${this.animationKey}`;
    const hashBytes = await sha256Bytes(data);

    const rnd = randomByte ?? Math.floor(Math.random() * 256);
    const bytesArr = [
      ...this.keyBytes,
      ...timeBytes,
      ...hashBytes.slice(0, 16),
      ADDITIONAL_RANDOM_NUMBER,
    ];
    const out = [rnd, ...bytesArr.map((b) => b ^ rnd)];
    return base64Encode(out).replace(/=/g, '');
  }

  /** Exposed for tests / diagnostics. */
  getAnimationKey(): string { return this.animationKey; }
}

// ── extraction (module-scope so tests can exercise them) ────────────────

export function resolveOnDemandUrl(html: string): string | null {
  const m = ON_DEMAND_FILE_HASH_REGEX.exec(html);
  if (m) {
    return `https://abs.twimg.com/responsive-web/client-web/${ON_DEMAND_CHUNK_NAME}.${m[2]}a.js`;
  }
  for (const re of ON_DEMAND_FALLBACK_REGEXES) {
    const fm = re.exec(html);
    if (fm) {
      // The direct-file fallback already carries the full hash; the chunk-map
      // fallback needs the reference's trailing 'a'.
      const isDirect = /ondemand\.s\./.test(fm[0]);
      return isDirect
        ? `https://abs.twimg.com/responsive-web/client-web/${ON_DEMAND_CHUNK_NAME}.${fm[1]}.js`
        : `https://abs.twimg.com/responsive-web/client-web/${ON_DEMAND_CHUNK_NAME}.${fm[1]}a.js`;
    }
  }
  return null;
}

export function extractIndices(ondemandJs: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  INDICES_REGEX.lastIndex = 0;
  while ((m = INDICES_REGEX.exec(ondemandJs)) !== null) out.push(parseInt(m[1], 10));
  return out;
}

/** Navigate the hidden SVG, build the 2D frame array, and animate the row. */
export function computeAnimationKey(
  doc: Document,
  keyBytes: number[],
  rowIndex: number,
  keyByteIndices: number[],
): string {
  const totalTime = 4096;
  const row = keyBytes[rowIndex] % 16;

  let frameTime = keyByteIndices.reduce((acc, idx) => acc * (keyBytes[idx] % 16), 1);
  frameTime = Math.round(frameTime / 10) * 10;

  const frames = Array.from(doc.querySelectorAll("[id^='loading-x-anim']"));
  if (!frames.length) throw new Error('x-client-transaction-id: no loading-x-anim frames in X shell.');
  const frame = frames[keyBytes[5] % 4];
  const g = frame.children[0] as Element;
  const path = g?.children[1] as Element;
  const dAttr = path?.getAttribute('d');
  if (!dAttr) throw new Error('x-client-transaction-id: animation path had no "d" attribute.');

  const arr = dAttr.substring(9).split('C').map((item) => {
    const cleaned = item.replace(/[^\d]+/g, ' ').trim();
    return cleaned === '' ? [] : cleaned.split(/\s+/).map((n) => parseInt(n, 10));
  });

  const frameRow = arr[row];
  if (!frameRow) throw new Error(`x-client-transaction-id: no frame row at index ${row}.`);
  return animate(frameRow, frameTime / totalTime);
}

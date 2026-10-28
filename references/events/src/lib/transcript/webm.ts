// Splits a WebM (Matroska) audio file into smaller standalone WebM files without decoding.
//
// Why: speech-to-text APIs cap the file size (Groq 25 MB on the free tier, OpenAI 25 MB),
// and recordings from the host console can reach 48 MB. A WebM file is a header (EBML
// header, Segment Info, Tracks) followed by Clusters of Opus frames, and each Cluster is
// decodable on its own. So a part is: the original header + a run of whole Clusters, with
// the Cluster timecodes shifted so each part starts at zero. The caller adds `offset`
// back to the timestamps the API returns.
//
// MediaRecorder writes "live" WebM: the Segment and often each Cluster have an unknown
// size. An unknown-size element ends where an element that cannot be its child begins,
// which is how this parser finds Cluster boundaries without searching for byte patterns.

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
} as const;

// Elements that may appear directly inside a Cluster (anything else ends an unknown-size Cluster).
const CLUSTER_CHILDREN = new Set([0xe7, 0xa3, 0xa0, 0xa7, 0xab, 0x5854, 0xaf, 0xec, 0xbf]);
// Elements that may appear directly inside a Segment.
const SEGMENT_CHILDREN = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367, 0xec, 0xbf]);

interface Vint { value: number; length: number; unknown: boolean }

function readId(b: Uint8Array, p: number): Vint {
  const first = b[p];
  if (first === undefined) throw new Error("Unexpected end of WebM data");
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4) throw new Error("Invalid WebM element id");
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[p + i];
  return { value: v, length: len, unknown: false };
}

function readSize(b: Uint8Array, p: number): Vint {
  const first = b[p];
  if (first === undefined) throw new Error("Unexpected end of WebM data");
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8) throw new Error("Invalid WebM element size");
  let v = first & (0xff >> len);
  let allOnes = v === 0xff >> len;
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) allOnes = false; }
  return { value: v, length: len, unknown: allOnes };
}

function readUint(b: Uint8Array, p: number, n: number) { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; }
function writeUint(b: Uint8Array, p: number, n: number, v: number) { for (let i = n - 1; i >= 0; i--) { b[p + i] = v % 256; v = Math.floor(v / 256); } }

interface Cluster { start: number; end: number; timecode: number; tcPos: number; tcLen: number }

export interface WebmLayout {
  header: Uint8Array;      // EBML header + Segment (unknown size) + Info + Tracks
  clusters: Cluster[];
  timecodeScale: number;   // nanoseconds per timecode tick (1e6 = milliseconds)
}

export function isWebm(b: Uint8Array) { return b.length > 4 && readUint(b, 0, 4) === ID.EBML; }

/** Reads the file's layout. Throws when the data is not WebM or cannot be followed. */
export function parseWebm(b: Uint8Array): WebmLayout {
  if (!isWebm(b)) throw new Error("Not a WebM file");
  let p = 0;
  const ebmlId = readId(b, p); const ebmlSize = readSize(b, p + ebmlId.length);
  const ebmlEnd = p + ebmlId.length + ebmlSize.length + ebmlSize.value;
  p = ebmlEnd;
  const segId = readId(b, p);
  if (segId.value !== ID.Segment) throw new Error("WebM file has no Segment");
  const segSize = readSize(b, p + segId.length);
  const segData = p + segId.length + segSize.length;
  const segEnd = segSize.unknown ? b.length : Math.min(b.length, segData + segSize.value);

  const keep: Uint8Array[] = [b.subarray(0, ebmlEnd), new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])];
  const clusters: Cluster[] = [];
  let timecodeScale = 1e6;
  p = segData;
  while (p < segEnd) {
    if (segEnd - p < 2) break;
    const id = readId(b, p); const size = readSize(b, p + id.length);
    const data = p + id.length + size.length;
    if (id.value === ID.Cluster) {
      const c = readCluster(b, p, data, size, segEnd);
      clusters.push(c);
      p = c.end;
      continue;
    }
    if (size.unknown) throw new Error("WebM element of unknown size outside a Cluster");
    const end = Math.min(segEnd, data + size.value);
    if (id.value === ID.Info) {
      keep.push(b.subarray(p, end));
      for (let q = data; q < end;) {
        const cid = readId(b, q); const cs = readSize(b, q + cid.length); const cd = q + cid.length + cs.length;
        if (cid.value === ID.TimecodeScale) timecodeScale = readUint(b, cd, cs.value);
        q = cd + cs.value;
      }
    } else if (id.value === ID.Tracks) keep.push(b.subarray(p, end));
    // SeekHead and Cues hold byte offsets into the original file, so they are left out.
    p = end;
  }
  if (!clusters.length) throw new Error("WebM file has no audio clusters");
  const header = new Uint8Array(keep.reduce((n, k) => n + k.length, 0));
  let o = 0; for (const k of keep) { header.set(k, o); o += k.length; }
  return { header, clusters, timecodeScale };
}

function readCluster(b: Uint8Array, start: number, data: number, size: Vint, segEnd: number): Cluster {
  const known = !size.unknown;
  const limit = known ? Math.min(segEnd, data + size.value) : segEnd;
  let timecode = 0, tcPos = -1, tcLen = 0;
  let q = data;
  while (q < limit) {
    if (limit - q < 2) { q = limit; break; }
    const id = readId(b, q);
    if (!known && !CLUSTER_CHILDREN.has(id.value)) {
      if (SEGMENT_CHILDREN.has(id.value)) break; // the next Cluster (or Cues) starts here
      throw new Error("Unexpected element inside a WebM cluster");
    }
    const s = readSize(b, q + id.length);
    if (s.unknown) throw new Error("Unknown-size element inside a WebM cluster");
    const d = q + id.length + s.length;
    if (id.value === ID.Timecode) { timecode = readUint(b, d, s.value); tcPos = d; tcLen = s.value; }
    q = Math.min(limit, d + s.value);
  }
  if (tcPos < 0) throw new Error("WebM cluster without a timecode");
  return { start, end: q, timecode, tcPos, tcLen };
}

export interface WebmPart { bytes: Uint8Array; offset: number }

/**
 * Splits into parts of at most about `maxBytes` (a single oversized cluster still makes its
 * own part). Each part is a valid WebM file starting at time zero; `offset` is its start
 * in seconds within the original recording.
 */
export function splitWebm(b: Uint8Array, maxBytes: number): WebmPart[] {
  const { header, clusters, timecodeScale } = parseWebm(b);
  const groups: Cluster[][] = [];
  let cur: Cluster[] = [], n = header.length;
  for (const c of clusters) {
    const len = c.end - c.start;
    if (cur.length && n + len > maxBytes) { groups.push(cur); cur = []; n = header.length; }
    cur.push(c); n += len;
  }
  if (cur.length) groups.push(cur);

  return groups.map((g) => {
    const base = g[0].timecode;
    const total = header.length + g.reduce((s, c) => s + (c.end - c.start), 0);
    const out = new Uint8Array(total);
    out.set(header, 0);
    let o = header.length;
    for (const c of g) {
      out.set(b.subarray(c.start, c.end), o);
      writeUint(out, o + (c.tcPos - c.start), c.tcLen, c.timecode - base);
      o += c.end - c.start;
    }
    return { bytes: out, offset: (base * timecodeScale) / 1e9 };
  });
}

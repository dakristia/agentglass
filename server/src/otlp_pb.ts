// Minimal, dependency-free OTLP/HTTP *protobuf* decoder for the traces signal.
//
// Most OpenTelemetry exporters send `application/x-protobuf` (not JSON) over
// HTTP, so to accept telemetry from Gemini CLI / Codex CLI / the OTel SDKs
// without a Collector in the middle we decode the protobuf wire format directly
// into the SAME shape as OTLP/JSON — then reuse otlpTracesToEvents().
//
// Only the fields the GenAI mapping needs are read; everything else is skipped.
// Field numbers per opentelemetry-proto (trace/v1/trace.proto, common/v1).

class Reader {
  private p = 0;
  constructor(private b: Uint8Array) {}
  get done() { return this.p >= this.b.length; }
  varint(): bigint {
    let shift = 0n, res = 0n;
    for (;;) {
      // A 64-bit varint is at most 10 bytes. Without this cap, a run of
      // continuation bytes builds an ever-larger BigInt — O(n²) work that pins
      // a core and then OOMs, from a single unauthenticated request. Also stop
      // at end-of-buffer instead of reading undefined as 0 forever.
      if (shift > 63n || this.p >= this.b.length) throw new Error("varint overflow");
      const byte = this.b[this.p++];
      res |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return res;
      shift += 7n;
    }
  }
  tag(): { field: number; wire: number } {
    const t = Number(this.varint());
    return { field: t >>> 3, wire: t & 7 };
  }
  bytes(): Uint8Array {
    const len = Number(this.varint());
    // A length prefix past the buffer end is malformed input, not a short read
    // to paper over — reject it so a partial decode isn't ingested as real data.
    if (len < 0 || this.p + len > this.b.length) throw new Error("length past end");
    const out = this.b.subarray(this.p, this.p + len);
    this.p += len;
    return out;
  }
  fixed64(): bigint {
    let v = 0n;
    for (let i = 0; i < 8; i++) v |= BigInt(this.b[this.p++]) << BigInt(8 * i);
    return v;
  }
  fixed32(): number {
    const v = this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16) | (this.b[this.p + 3] << 24);
    this.p += 4;
    return v >>> 0;
  }
  /** Advance past a field we don't care about. */
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.p += 4;
  }
}

const td = new TextDecoder();
const str = (b: Uint8Array) => td.decode(b);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const f64 = (bits: bigint) => new DataView(new BigUint64Array([bits]).buffer).getFloat64(0, true);

// AnyValue nests through kvlist/array back into AnyValue with no natural bound,
// so a crafted message can recurse until the stack overflows. 32 levels is far
// past anything real telemetry produces.
let depth = 0;

// --- AnyValue → the {stringValue|intValue|...} shape attrValue() expects ------
function anyValue(b: Uint8Array): Record<string, unknown> {
  if (++depth > 32) { depth--; throw new Error("attribute nesting too deep"); }
  try {
  const r = new Reader(b);
  const out: Record<string, unknown> = {};
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) out.stringValue = str(r.bytes());
    else if (field === 2 && wire === 0) out.boolValue = r.varint() !== 0n;
    else if (field === 3 && wire === 0) out.intValue = r.varint().toString();
    else if (field === 4 && wire === 1) out.doubleValue = f64(r.fixed64());
    else if (field === 5 && wire === 2) out.arrayValue = { values: arrayValue(r.bytes()) };
    else if (field === 6 && wire === 2) out.kvlistValue = { values: keyValues(r.bytes()) };
    else r.skip(wire);
  }
  return out;
  } finally { depth--; }
}
function arrayValue(b: Uint8Array): Record<string, unknown>[] {
  const r = new Reader(b);
  const vals: Record<string, unknown>[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) vals.push(anyValue(r.bytes()));
    else r.skip(wire);
  }
  return vals;
}
// One KeyValue message: { string key = 1; AnyValue value = 2; }
function keyValue(b: Uint8Array): { key: string; value: Record<string, unknown> } {
  const r = new Reader(b);
  let key = "", value: Record<string, unknown> = {};
  while (!r.done) {
    const t = r.tag();
    if (t.field === 1 && t.wire === 2) key = str(r.bytes());
    else if (t.field === 2 && t.wire === 2) value = anyValue(r.bytes());
    else r.skip(t.wire);
  }
  return { key, value };
}
// A message whose field 1 is `repeated KeyValue` (Resource, KeyValueList).
function keyValues(b: Uint8Array): { key: string; value: Record<string, unknown> }[] {
  const r = new Reader(b);
  const out: { key: string; value: Record<string, unknown> }[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) out.push(keyValue(r.bytes()));
    else r.skip(wire);
  }
  return out;
}

function span(b: Uint8Array) {
  const r = new Reader(b);
  const s: Record<string, unknown> = { attributes: [] as unknown[] };
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) s.traceId = hex(r.bytes());
    else if (field === 2 && wire === 2) s.spanId = hex(r.bytes());
    else if (field === 5 && wire === 2) s.name = str(r.bytes());
    else if (field === 6 && wire === 0) s.kind = Number(r.varint());
    else if (field === 7 && wire === 1) s.startTimeUnixNano = r.fixed64().toString();
    else if (field === 8 && wire === 1) s.endTimeUnixNano = r.fixed64().toString();
    else if (field === 9 && wire === 2) (s.attributes as unknown[]).push(keyValue(r.bytes()));
    else if (field === 15 && wire === 2) {
      const st = new Reader(r.bytes());
      const status: Record<string, unknown> = {};
      while (!st.done) {
        const t = st.tag();
        if (t.field === 2 && t.wire === 2) status.message = str(st.bytes());
        else if (t.field === 3 && t.wire === 0) status.code = Number(st.varint());
        else st.skip(t.wire);
      }
      s.status = status;
    } else r.skip(wire);
  }
  return s;
}

function scopeSpans(b: Uint8Array) {
  const r = new Reader(b);
  const spans: unknown[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 2 && wire === 2) spans.push(span(r.bytes()));
    else r.skip(wire);
  }
  return { spans };
}

function resourceSpans(b: Uint8Array) {
  const r = new Reader(b);
  let resource: Record<string, unknown> = { attributes: [] as unknown[] };
  const scope: unknown[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) resource = { attributes: keyValues(r.bytes()) }; // Resource.attributes = repeated KeyValue (field 1)
    else if (field === 2 && wire === 2) scope.push(scopeSpans(r.bytes()));
    else r.skip(wire);
  }
  return { resource, scopeSpans: scope };
}

/** Decode an OTLP/HTTP ExportTraceServiceRequest protobuf into the OTLP-JSON
 *  shape that otlpTracesToEvents() consumes. */
export function decodeOtlpTraces(buf: ArrayBuffer | Uint8Array): { resourceSpans: unknown[] } {
  const r = new Reader(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const rs: unknown[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) rs.push(resourceSpans(r.bytes()));
    else r.skip(wire);
  }
  return { resourceSpans: rs };
}

// --- OTLP LOGS (logs/v1/logs.proto) ----------------------------------------
function logRecord(b: Uint8Array) {
  const r = new Reader(b);
  const rec: Record<string, unknown> = { attributes: [] as unknown[] };
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 1) rec.timeUnixNano = r.fixed64().toString();
    else if (field === 2 && wire === 0) rec.severityNumber = Number(r.varint());
    else if (field === 5 && wire === 2) rec.body = anyValue(r.bytes());
    else if (field === 6 && wire === 2) (rec.attributes as unknown[]).push(keyValue(r.bytes()));
    else if (field === 9 && wire === 2) rec.traceId = hex(r.bytes());
    else if (field === 11 && wire === 1) rec.observedTimeUnixNano = r.fixed64().toString();
    else if (field === 12 && wire === 2) rec.eventName = str(r.bytes());
    else r.skip(wire);
  }
  return rec;
}

function scopeLogs(b: Uint8Array) {
  const r = new Reader(b);
  const logRecords: unknown[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 2 && wire === 2) logRecords.push(logRecord(r.bytes()));
    else r.skip(wire);
  }
  return { logRecords };
}

function resourceLogs(b: Uint8Array) {
  const r = new Reader(b);
  let resource: Record<string, unknown> = { attributes: [] as unknown[] };
  const scope: unknown[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) resource = { attributes: keyValues(r.bytes()) };
    else if (field === 2 && wire === 2) scope.push(scopeLogs(r.bytes()));
    else r.skip(wire);
  }
  return { resource, scopeLogs: scope };
}

/** Decode an OTLP/HTTP ExportLogsServiceRequest protobuf into the OTLP-JSON
 *  shape that otlpLogsToEvents() consumes. */
export function decodeOtlpLogs(buf: ArrayBuffer | Uint8Array): { resourceLogs: unknown[] } {
  const r = new Reader(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const rl: unknown[] = [];
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) rl.push(resourceLogs(r.bytes()));
    else r.skip(wire);
  }
  return { resourceLogs: rl };
}

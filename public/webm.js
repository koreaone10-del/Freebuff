/*
 * تصحيح مدة ملفات WebM الناتجة عن MediaRecorder داخل المتصفح.
 *
 * ملفات MediaRecorder (Firefox ومتصفحات أخرى) تُكتب بثّاً حيّاً، فلا يعرف المسجّل
 * المدة النهائية: يكتب Segment بحجم مجهول، ويحذف عنصر Duration من Info. النتيجة أن
 * كثيراً من المشغلات تعرض المدة "∞" أو 0:00، ويفشل شريط التقدّم في العمل.
 *
 * هنا نحسب المدة من طوابع الكتل الفعلية (Timecode لكل Cluster + الطابع النسبي لكل
 * Block)، ثم نكتب Duration داخل Info. إن لم يكن موجوداً نُدرجه (11 بايت) ونُحدّث
 * أحجام Info وSegment، ونُصحّح إزاحات SeekHead وCues المتأثرة بالإدراج، فلا يبقى
 * أي مرجع إلى موضع قديم. لا سيرفر ولا محوّل: كل شيء داخل المتصفح.
 */
(function (root) {
  "use strict";

  const ID = {
    EBML: 0x1a45dfa3,
    SEGMENT: 0x18538067,
    SEEKHEAD: 0x114d9b74,
    SEEK: 0x4dbb,
    SEEK_POSITION: 0x53ac,
    INFO: 0x1549a966,
    TIMECODE_SCALE: 0x2ad7b1,
    DURATION: 0x4489,
    CLUSTER: 0x1f43b675,
    TIMECODE: 0xe7,
    SIMPLE_BLOCK: 0xa3,
    BLOCK_GROUP: 0xa0,
    BLOCK: 0xa1,
    CUES: 0x1c53bb6b,
    CUE_POINT: 0xbb,
    CUE_CLUSTER_POSITION: 0xf1
  };

  function readVint(u8, pos, keepMarker) {
    if (pos >= u8.length) return null;
    const first = u8[pos];
    if (!first) return null;
    let mask = 0x80;
    let len = 1;
    while (len <= 8 && !(first & mask)) {
      mask >>= 1;
      len++;
    }
    if (len > 8 || pos + len > u8.length) return null;
    let value = keepMarker ? first : first & (mask - 1);
    for (let i = 1; i < len; i++) value = value * 256 + u8[pos + i];
    const unknown = !keepMarker && value === Math.pow(2, 7 * len) - 1;
    return { value: value, len: len, unknown: unknown };
  }

  function readUint(u8, start, len) {
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + u8[start + i];
    return v;
  }

  function readFloat(u8, start, len) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (len === 4) return dv.getFloat32(start);
    if (len === 8) return dv.getFloat64(start);
    return NaN;
  }

  // يمرّ على عناصر EBML في نطاق محدد. unknownSize يعني القراءة حتى النهاية.
  function eachElement(u8, start, end, visit) {
    let pos = start;
    while (pos + 2 <= end) {
      const id = readVint(u8, pos, true);
      if (!id) return;
      const size = readVint(u8, pos + id.len);
      if (!size) return;
      const dataStart = pos + id.len + size.len;
      const dataEnd = size.unknown ? end : Math.min(end, dataStart + size.value);
      if (visit({ id: id.value, idStart: pos, idLen: id.len, sizeStart: pos + id.len, sizeLen: size.len, size: size.value, unknown: size.unknown, dataStart: dataStart, dataEnd: dataEnd, total: dataEnd - pos }) === false) return;
      if (size.unknown) return;
      pos = dataEnd;
    }
  }

  function vintWidthFor(value, minWidth) {
    for (let w = minWidth || 1; w <= 8; w++) {
      const max = Math.pow(2, 7 * w) - 2; // كل البتات مشتعلة = حجم مجهول، لذا نستثنيه
      if (value <= max) return w;
    }
    return -1;
  }

  function encodeVintWidth(value, width) {
    const out = new Uint8Array(width);
    let v = value;
    for (let i = width - 1; i >= 0; i--) {
      out[i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    out[0] |= 0x80 >> (width - 1);
    return out;
  }

  // يحلل ملف WebM ويجمع كل ما نحتاجه لتصحيح المدة.
  function analyze(u8) {
    const info = {
      valid: false,
      segment: null,
      info: null,
      timecodeScale: 1000000,
      duration: null,
      seekPositions: [],
      cuePositions: [],
      lastTime: 0,
      times: [],
      clusters: 0
    };

    eachElement(u8, 0, u8.length, (el) => {
      if (el.id === ID.EBML) info.valid = true;
      if (el.id !== ID.SEGMENT) return;
      info.segment = el;
      const segEnd = el.unknown ? u8.length : el.dataEnd;

      eachElement(u8, el.dataStart, segEnd, (child) => {
        if (child.id === ID.INFO) {
          info.info = child;
          eachElement(u8, child.dataStart, child.dataEnd, (f) => {
            if (f.id === ID.TIMECODE_SCALE) info.timecodeScale = readUint(u8, f.dataStart, f.dataEnd - f.dataStart) || 1000000;
            else if (f.id === ID.DURATION) info.duration = { start: f.dataStart, len: f.dataEnd - f.dataStart, value: readFloat(u8, f.dataStart, f.dataEnd - f.dataStart) };
          });
        } else if (child.id === ID.SEEKHEAD) {
          eachElement(u8, child.dataStart, child.dataEnd, (seek) => {
            if (seek.id !== ID.SEEK) return;
            eachElement(u8, seek.dataStart, seek.dataEnd, (f) => {
              if (f.id === ID.SEEK_POSITION) info.seekPositions.push({ start: f.dataStart, len: f.dataEnd - f.dataStart });
            });
          });
        } else if (child.id === ID.CUES) {
          eachElement(u8, child.dataStart, child.dataEnd, (point) => {
            if (point.id !== ID.CUE_POINT) return;
            eachElement(u8, point.dataStart, point.dataEnd, (f) => {
              if (f.id === ID.CUE_CLUSTER_POSITION) info.cuePositions.push({ start: f.dataStart, len: f.dataEnd - f.dataStart });
            });
          });
        } else if (child.id === ID.CLUSTER) {
          info.clusters++;
          let clusterTime = 0;
          let clusterLast = 0;
          eachElement(u8, child.dataStart, child.dataEnd, (c) => {
            if (c.id === ID.TIMECODE) {
              clusterTime = readUint(u8, c.dataStart, c.dataEnd - c.dataStart);
            } else if (c.id === ID.SIMPLE_BLOCK || c.id === ID.BLOCK_GROUP) {
              const findBlock = (b) => {
                const track = readVint(u8, b.dataStart, false);
                if (!track) return;
                const relPos = b.dataStart + track.len;
                if (relPos + 2 > b.dataEnd) return;
                let rel = (u8[relPos] << 8) | u8[relPos + 1];
                if (rel & 0x8000) rel -= 0x10000;
                const t = clusterTime + rel;
                info.times.push(t);
                if (t > clusterLast) clusterLast = t;
                if (t > info.lastTime) info.lastTime = t;
              };
              if (c.id === ID.SIMPLE_BLOCK) findBlock(c);
              else eachElement(u8, c.dataStart, c.dataEnd, (b) => { if (b.id === ID.BLOCK) findBlock(b); });
            }
          });
          if (clusterLast > info.lastTime) info.lastTime = clusterLast;
        }
      });
      return false;
    });

    return info;
  }

  // مدة آخر إطار: وسيط الفروق بين آخر الطوابع، لتقدير لحظة عرض الإطار الأخير.
  function lastFrameStep(times) {
    if (times.length < 2) return 0;
    const sorted = Array.from(new Set(times)).sort((a, b) => a - b);
    const deltas = [];
    for (let i = Math.max(1, sorted.length - 6); i < sorted.length; i++) {
      const d = sorted[i] - sorted[i - 1];
      if (d > 0) deltas.push(d);
    }
    if (!deltas.length) return 0;
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)];
  }

  function writeUint(u8, start, len, value) {
    let v = value;
    for (let i = len - 1; i >= 0; i--) {
      u8[start + i] = v & 0xff;
      v = Math.floor(v / 256);
    }
  }

  function concat(parts, total) {
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  /*
   * fixDuration(bytes, fallbackSeconds) -> { bytes, changed, duration, mode }
   * mode: "updated" (كان Duration موجوداً) | "inserted" (أُدرج) | "none"
   */
  function fixDuration(bytes, fallbackSeconds) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const u8 = new Uint8Array(src);
    const res = { bytes: u8, changed: false, duration: 0, mode: "none" };

    let info;
    try { info = analyze(u8); } catch (_) { return res; }
    if (!info.valid || !info.info || !info.segment) return res;

    const scale = info.timecodeScale || 1000000;
    const step = lastFrameStep(info.times);
    let units = info.lastTime > 0 ? info.lastTime + step : 0;
    const fallback = Number(fallbackSeconds) > 0 ? Number(fallbackSeconds) : 0;
    if (!units && fallback) units = Math.round((fallback * 1e9) / scale);
    if (!units) return res;

    res.duration = (units * scale) / 1e9;

    // الحالة الأولى: Duration موجود أصلاً — نكتب قيمته في مكانه بلا أي إزاحة.
    if (info.duration && (info.duration.len === 4 || info.duration.len === 8)) {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      if (info.duration.len === 8) dv.setFloat64(info.duration.start, units);
      else dv.setFloat32(info.duration.start, units);
      res.changed = true;
      res.mode = "updated";
      return res;
    }

    // الحالة الثانية: نُدرج عنصر Duration (0x4489, حجم 8, float64) في نهاية Info.
    const ins = new Uint8Array(11);
    ins[0] = 0x44;
    ins[1] = 0x89;
    ins[2] = 0x88;
    new DataView(ins.buffer).setFloat64(3, units);

    const infoSize = info.info.dataEnd - info.info.dataStart;
    const newInfoSize = infoSize + ins.length;
    const width = vintWidthFor(newInfoSize, info.info.sizeLen);
    if (width !== info.info.sizeLen) return res; // لا يمكن وصف الحجم الجديد بنفس العرض

    const insertAt = info.info.dataEnd;
    const parts = [u8.subarray(0, insertAt), ins, u8.subarray(insertAt)];
    const out = concat(parts, u8.length + ins.length);

    const shift = (off) => (off >= insertAt ? off + ins.length : off);
    const shiftRel = (rel) => (rel >= insertAt - info.segment.dataStart ? rel + ins.length : rel);

    // حجم Info الجديد
    out.set(encodeVintWidth(newInfoSize, info.info.sizeLen), info.info.sizeStart);

    // حجم Segment إن كان معروفاً (المجهول يبقى مجهولاً ولا يحتاج تعديلاً)
    if (!info.segment.unknown) {
      const newSegSize = info.segment.size + ins.length;
      const w = vintWidthFor(newSegSize, info.segment.sizeLen);
      if (w === info.segment.sizeLen) out.set(encodeVintWidth(newSegSize, w), info.segment.sizeStart);
      else return res;
    }

    // إزاحات SeekHead وCues نسبية لبداية بيانات Segment. بعد الإدراج نُضيف مقدار
    // الإدراج لكل موضع واقع بعده — بأعداد صحيحة عادية، لا بترميز VINT (الحجم VINT
    // أما القيمة فبايتات صحيحة).
    const needWidth = (value) => {
      let w = 1;
      while (value >= Math.pow(256, w)) w++;
      return w;
    };
    for (const p of info.seekPositions.concat(info.cuePositions)) {
      const v = readUint(out, shift(p.start), p.len);
      if (shiftRel(v) !== v && needWidth(shiftRel(v)) > p.len) return res; // لا يتسع الحقل
    }
    for (const p of info.seekPositions) writeUint(out, shift(p.start), p.len, shiftRel(readUint(out, shift(p.start), p.len)));
    for (const p of info.cuePositions) writeUint(out, shift(p.start), p.len, shiftRel(readUint(out, shift(p.start), p.len)));

    res.bytes = out;
    res.changed = true;
    res.mode = "inserted";
    return res;
  }

  function inspect(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const info = analyze(u8);
    const scale = info.timecodeScale || 1000000;
    return {
      valid: info.valid,
      clusters: info.clusters,
      timecodeScale: scale,
      lastTime: info.lastTime,
      blocks: info.times.length,
      durationElement: info.duration ? (info.duration.value * scale) / 1e9 : null,
      segmentUnknownSize: !!(info.segment && info.segment.unknown),
      seekPositions: info.seekPositions.length,
      cues: info.cuePositions.length,
      estimatedSeconds: (info.lastTime + lastFrameStep(info.times)) * scale / 1e9
    };
  }

  const api = { fixDuration: fixDuration, inspect: inspect };
  root.VD_WEBM = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

/*
 * تصحيح بيانات MP4 المجزّأ (fMP4) الناتج عن MediaRecorder داخل المتصفح.
 *
 * ملفات MediaRecorder تكون عادة: ftyp + moov(mvhd/trak/mvex) + سلاسل من moof+mdat،
 * وmvhd فيها duration = 0 لأن المدة لا تُعرف إلا بعد انتهاء التسجيل. كثير من
 * المشغلات والمحررات (QuickTime، Windows، بعض محررات الهاتف) تعتمد على هذا الحقل
 * فتعرض 0:00 أو مدة خاطئة أو ترفض الاستيراد.
 *
 * هذا الملف يحسب المدة الحقيقية من مجموع مدد العينات داخل trun (أو من
 * default_sample_duration في tfhd)، ثم يكتبها في mvhd وtkhd وmdhd وmehd
 * في أماكنها نفسها دون تغيير حجم الملف ولا إزاحة أي بايت، ويجعل أول tfdt = 0
 * عند وجود إزاحة بداية. لا يوجد أي رفع أو خدمة خارجية: كل شيء داخل المتصفح.
 */
(function (root) {
  "use strict";

  function viewOf(u8) {
    return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  }

  function typeAt(u8, off) {
    return String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
  }

  // يمرّ على صناديق MP4 في نطاق محدد؛ visit تُعيد false لإيقاف المرور.
  function walk(u8, dv, start, end, visit) {
    let off = start;
    while (off + 8 <= end) {
      let size = dv.getUint32(off);
      let hdr = 8;
      if (size === 1) {
        if (off + 16 > end) return;
        size = Number(dv.getBigUint64(off + 8));
        hdr = 16;
      } else if (size === 0) {
        size = end - off;
      }
      if (size < hdr || off + size > end) return;
      if (visit(typeAt(u8, off + 4), off, hdr, size) === false) return;
      off += size;
    }
  }

  function readDur(dv, off, ver) {
    return ver === 1 ? Number(dv.getBigUint64(off)) : dv.getUint32(off);
  }

  function writeDur(dv, off, ver, value) {
    const v = Math.max(0, Math.round(value));
    if (ver === 1) dv.setBigUint64(off, BigInt(v));
    else dv.setUint32(off, Math.min(0xffffffff, v));
  }

  // يحلل البنية ويجمع المدد. لا يعدّل شيئاً.
  function parse(u8) {
    const dv = viewOf(u8);
    const st = {
      movieTimescale: 0,
      mvhd: null,
      mehd: null,
      traks: [],
      tracks: new Map(),
      fragments: 0
    };

    function track(id) {
      let t = st.tracks.get(id);
      if (!t) {
        t = { id: id, sum: 0, tfdt: [], base: null, timescale: 0, mdhd: null, tkhd: null };
        st.tracks.set(id, t);
      }
      return t;
    }

    function scanTrak(start, end) {
      const rec = { id: 0, tkhd: null, mdhd: null, timescale: 0 };
      walk(u8, dv, start, end, (type, off, hdr, size) => {
        const p = off + hdr;
        if (type === "tkhd") {
          const v = u8[p];
          rec.id = dv.getUint32(v === 1 ? p + 20 : p + 12);
          rec.tkhd = { off: v === 1 ? p + 28 : p + 20, ver: v };
        } else if (type === "mdia") {
          walk(u8, dv, p, off + size, (t2, o2, h2) => {
            if (t2 !== "mdhd") return;
            const q = o2 + h2;
            const v = u8[q];
            rec.timescale = dv.getUint32(v === 1 ? q + 20 : q + 12);
            rec.mdhd = { off: v === 1 ? q + 24 : q + 16, ver: v };
          });
        }
      });
      if (rec.id) {
        const t = track(rec.id);
        t.tkhd = rec.tkhd;
        t.mdhd = rec.mdhd;
        t.timescale = rec.timescale || t.timescale;
        st.traks.push(t);
      }
    }

    function scanMoov(start, end) {
      walk(u8, dv, start, end, (type, off, hdr, size) => {
        const p = off + hdr;
        if (type === "mvhd") {
          const v = u8[p];
          st.movieTimescale = dv.getUint32(v === 1 ? p + 20 : p + 12);
          st.mvhd = { off: v === 1 ? p + 24 : p + 16, ver: v };
        } else if (type === "trak") {
          scanTrak(p, off + size);
        } else if (type === "mvex") {
          walk(u8, dv, p, off + size, (t2, o2, h2) => {
            if (t2 !== "mehd") return;
            const q = o2 + h2;
            st.mehd = { off: q + 4, ver: u8[q] };
          });
        }
      });
    }

    function scanMoof(start, end) {
      walk(u8, dv, start, end, (type, off, hdr, size) => {
        if (type !== "traf") return;
        const p = off + hdr;
        let id = 0;
        let defDur = 0;
        walk(u8, dv, p, off + size, (t2, o2, h2) => {
          const q = o2 + h2;
          if (t2 === "tfhd") {
            const flags = dv.getUint32(q) & 0xffffff;
            id = dv.getUint32(q + 4);
            let o = q + 8;
            if (flags & 0x01) o += 8; // base_data_offset
            if (flags & 0x02) o += 4; // sample_description_index
            if (flags & 0x08) defDur = dv.getUint32(o); // default_sample_duration
          } else if (t2 === "trun") {
            if (!id) return;
            const flags = dv.getUint32(q) & 0xffffff;
            const count = dv.getUint32(q + 4);
            let o = q + 8;
            if (flags & 0x01) o += 4; // data_offset
            if (flags & 0x04) o += 4; // first_sample_flags
            let sum = 0;
            if (flags & 0x100) {
              let step = 4;
              if (flags & 0x200) step += 4;
              if (flags & 0x400) step += 4;
              if (flags & 0x800) step += 4;
              for (let i = 0; i < count; i++) sum += dv.getUint32(o + i * step);
            } else {
              sum = count * defDur;
            }
            track(id).sum += sum;
          } else if (t2 === "tfdt") {
            if (!id) return;
            const v = u8[q];
            const off2 = q + 4;
            const time = readDur(dv, off2, v);
            const t = track(id);
            t.tfdt.push({ off: off2, ver: v });
            if (t.base === null) t.base = time;
          }
        });
      });
    }

    walk(u8, dv, 0, u8.length, (type, off, hdr, size) => {
      if (type === "moov") scanMoov(off + hdr, off + size);
      else if (type === "moof") {
        st.fragments++;
        scanMoof(off + hdr, off + size);
      }
    });

    return st;
  }

  // يقرأ المدد المسجّلة حالياً (للاختبار والتشخيص).
  function inspect(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = viewOf(u8);
    const st = parse(u8);
    const out = {
      segmented: st.fragments > 0,
      fragments: st.fragments,
      movieTimescale: st.movieTimescale,
      movieDuration: st.mvhd ? readDur(dv, st.mvhd.off, st.mvhd.ver) : 0,
      tracks: []
    };
    for (const t of st.tracks.values()) {
      out.tracks.push({
        id: t.id,
        timescale: t.timescale,
        sampleDuration: t.sum,
        mdhd: t.mdhd ? readDur(dv, t.mdhd.off, t.mdhd.ver) : null,
        tkhd: t.tkhd ? readDur(dv, t.tkhd.off, t.tkhd.ver) : null,
        firstTfdt: t.base
      });
    }
    out.seconds = out.movieTimescale ? out.movieDuration / out.movieTimescale : 0;
    return out;
  }

  /*
   * fixDuration(bytes, fallbackSeconds) -> { bytes, changed, duration, patched }
   * - bytes: Uint8Array أو ArrayBuffer (يُعدَّل في مكانه، ابعث نسخة إن أردت الأصل)
   * - fallbackSeconds: المدة المخططة، تُستخدم فقط إذا خلت المقاطع من مدد العينات
   */
  function fixDuration(bytes, fallbackSeconds) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const u8 = new Uint8Array(src); // نسخة نعمل عليها
    const dv = viewOf(u8);
    const st = parse(u8);
    const result = { bytes: u8, changed: false, duration: 0, patched: 0 };

    if (!st.fragments || !st.movieTimescale) {
      result.duration = inspect(u8).seconds;
      return result;
    }

    const mts = st.movieTimescale;
    const fallback = Number(fallbackSeconds) > 0 ? Number(fallbackSeconds) : 0;
    const rows = [];
    for (const t of st.tracks.values()) {
      const ts = t.timescale || 0;
      let mediaDur = t.sum > 0 ? t.sum : 0;
      if (!mediaDur && fallback > 0 && ts) mediaDur = Math.round(fallback * ts);
      const movieDur = mediaDur > 0 && ts ? Math.round((mediaDur * mts) / ts) : 0;
      rows.push({ t: t, mediaDur: mediaDur, movieDur: movieDur });
    }
    const total = rows.reduce((m, x) => Math.max(m, x.movieDur), 0);
    if (!total) {
      result.duration = 0;
      return result;
    }

    if (st.mvhd) {
      writeDur(dv, st.mvhd.off, st.mvhd.ver, total);
      result.patched++;
    }
    if (st.mehd) {
      writeDur(dv, st.mehd.off, st.mehd.ver, total);
      result.patched++;
    }
    for (const x of rows) {
      if (x.t.mdhd && x.mediaDur > 0) {
        writeDur(dv, x.t.mdhd.off, x.t.mdhd.ver, x.mediaDur);
        result.patched++;
      }
      if (x.t.tkhd && x.movieDur > 0) {
        writeDur(dv, x.t.tkhd.off, x.t.tkhd.ver, x.movieDur);
        result.patched++;
      }
    }

    // إزاحة بداية التسجيل: اجعل أول عينة في كل مسار عند الصفر بدل وقت وصولها.
    for (const t of st.tracks.values()) {
      if (!t.base) continue;
      for (const f of t.tfdt) {
        const cur = readDur(dv, f.off, f.ver);
        writeDur(dv, f.off, f.ver, Math.max(0, cur - t.base));
        result.patched++;
      }
    }

    result.changed = result.patched > 0;
    result.duration = total / mts;
    return result;
  }

  const api = { fixDuration: fixDuration, inspect: inspect };
  root.VD_MP4 = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

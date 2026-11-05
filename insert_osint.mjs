import fs from 'fs';

const path = '/workspace/chats/b39cae5be4b89999629da062/worker.js';
const s = fs.readFileSync(path, 'utf8');

const r = `
// ---------- وحدة استخبارات بيانات بسيطة (OSINT) لا حاجة لرخصة أو مفتاح دفع ----------
const OSINT_SOURCES = [{
  id: "dl",
  label: "مُعمّن خاص",
  title: "أدوات مفتوحة المصدر لاستخبارات البيانات",
  url: "https://github.com/apurvscheme",
  remarks: "واجهة مباشرة للبحث في قواعد بيانات الوجوه والوصفات العامة (عرض للاستخدام الحرفي فقط).",
  about: "شبكة حارّة من الواجهات والروابط والأدوات المصغرة مُعدّة لاستخراج البيانات والاتصالات عبر الشبكة."
}, {
  id: "stories",
  label: "قصص حيّة (Unfiltered)",
  title: "قصص حيّة لجميع أنواع المشاريع (Unfiltered)",
  url: "https://airplanes.live",
  remarks: "شاشة حيّة رقمية مصغّرة، كلّ مشاريعها تظهر في مسار زمني واحد وصوري، وصولاً إلى حالة الأكثر تعلّقاً بالآن.",
  about: "رفع المشاهدات والوصول والتتبّع لجميع أنواع المحتوى الرقمي في مكان واحد."
}, {
  id: "fcid",
  label: "Facecheck.id",
  title: "Facecheck.id",
  url: "https://facecheck.id/fr",
  remarks: "البحث عن صورة وجه واحدة وترادفها مع الصور المفتوحة على الإنترنت (دعم الحجوم الإعلامية والذكاء الاصطناعي).",
  about: "مكتبة تعرّف مواضيع الصور ثمّ الانتقال لاستخراج بيانات المحتوى عن طريق الأرشيفات المتاحة."
}];
`;

const a = s.indexOf('function handleVideoPlan');
if (a === -1) { console.error('handleVideoPlan not found'); process.exit(1); }
const seg = s.slice(0, a) + r + s.slice(a);
fs.writeFileSync(path, seg);
console.log('inserted, len', seg.length);

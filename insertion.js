import fs from 'fs';
const s = fs.readFileSync('/workspace/chats/b39cae5be4b89999629da062/worker.js', 'utf8');
const src = `
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
const marker = '/**/---------- نطق مجاني';
const i = s.indexOf(marker);
if (i === -1) { console.error('marker not found'); process.exit(1); }
const seg = s.slice(0, i) + src + s.slice(i);
fs.writeFileSync('/workspace/chats/b39cae5be4b89999629da062/worker.js', seg);
console.log('inserted, len', seg.length);

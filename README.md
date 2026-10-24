# آن AI

مساعد ذكي مخصص لـ **آن coffee** — شمال محايل عسير.

## التشغيل
```bash
npm start
```

المسارات:
- `/` واجهة العميل
- `/admin` لوحة الإدارة
- `/health` فحص الخدمة

## متغيرات Railway
- `ADMIN_PIN`: رمز دخول لوحة الإدارة.
- `PORT`: يحدده Railway تلقائيًا.

النسخة الأولى تعمل من قاعدة معرفة مؤكدة ولا تخترع الأسعار أو أوقات العمل أو تفاصيل لم تعتمد بعد.

## بطاقة Apple Wallet (`/wallet`)
صفحة `/wallet` تعرض بطاقة آن coffee وفيها باركود الموقع، وزر «أضف إلى Apple Wallet» يحمّل ملف `.pkpass` من `/api/pass`.
Apple لا تقبل أي بطاقة إلا موقّعة بشهادة من حساب Apple Developer، فالزر يبقى معطّلًا حتى تضاف المتغيرات التالية:

| المتغير | القيمة |
|---|---|
| `APPLE_PASS_TYPE_ID` | معرّف البطاقة، مثل `pass.com.anncoffee.card` |
| `APPLE_TEAM_ID` | رمز الفريق (10 خانات) من حساب المطوّر |
| `APPLE_PASS_CERT` | شهادة Pass Type ID بصيغة PEM (أو base64 لها) |
| `APPLE_PASS_KEY` | المفتاح الخاص لها بصيغة PEM (أو base64) |
| `APPLE_WWDR_CERT` | شهادة Apple WWDR (G4) بصيغة PEM (أو base64) |
| `APPLE_PASS_KEY_PASSPHRASE` | اختياري، إذا كان المفتاح بكلمة مرور |
| `SITE_URL` | اختياري، رابط الموقع الذي يفتحه الباركود |

الخطوات:
1. اشترك في Apple Developer Program.
2. من Certificates, Identifiers & Profiles: أنشئ **Pass Type ID** ثم أنشئ له شهادة (Certificate) ونزّلها.
3. حوّل الشهادة والمفتاح إلى PEM:
   `openssl pkcs12 -in pass.p12 -clcerts -nokeys -out cert.pem` و `openssl pkcs12 -in pass.p12 -nocerts -nodes -out key.pem`
4. نزّل شهادة **WWDR G4** من صفحة Apple للشهادات وحوّلها: `openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem`
5. أضف المتغيرات في Vercel أو Railway (يمكن لصق المحتوى كما هو أو `base64 -w0 file.pem`)، ثم أعد النشر.

لا ترفع ملفات `.pem` أو `.p12` إلى المستودع. الباركود الحالي يفتح `https://ann-ai-lac.vercel.app`، وملفاته `public/qr.svg` و`public/qr.png`.

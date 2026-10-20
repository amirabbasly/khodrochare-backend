# قرارداد API نسخه ۱

Base URL: `https://API_DOMAIN/api/v1`. JSON با UTF-8، زمان ISO-8601 در UTC، فاصله متر و مبلغ **تومان** است. ترتیب مختصات در JSON `latitude`, `longitude` است. در UI ساعت را با `Asia/Tehran` نمایش دهید. مدارک را در درخواست JSON به صورت base64 نفرستید.

توکن ورود opaque است، JWT نیست. برای مسیرهای محافظت‌شده:

```http
Authorization: Bearer TOKEN
```

توکن در دیتابیس به صورت SHA-256 ذخیره می‌شود، پس از `SESSION_DAYS` منقضی می‌شود و logout فوراً آن را باطل می‌کند. کلاینت پس از 401 باید دوباره وارد شود. توکن، کد ملی و مدارک را در log یا URL نگذارید.

## خدمات

`GET /services` بدون ورود:

| مقدار ارسالی | عنوان |
| --- | --- |
| `REPAIR` | تعمیر در محل |
| `MOBILE_CARWASH` | کارواش سیار |
| `PERIODIC_SERVICE` | سرویس دوره‌ای خودرو در محل |
| `TOWING` | حمل خودرو |
| `INSPECTION` | کارشناسی خودرو |

## مدارک

`POST /documents` با `multipart/form-data` و یک فیلد فایل با نام `file`. فقط PNG/JPEG با حداکثر حجم ۵ مگابایت. آپلود پیش از ثبت‌نام مجاز است، اما دریافت تصویر فقط برای مالک واردشده ممکن است. پاسخ 201:

```json
{ "id": "UUID", "token": "ONE_TIME_DOCUMENT_TOKEN", "expiresInSeconds": 86400 }
```

در ثبت‌نام یا افزودن خودرو، `{ "id": "UUID", "token": "..." }` را ارسال کنید. توکن سند یک‌بارمصرف است و فقط تا ۲۴ ساعت برای اتصال سند به حساب اعتبار دارد. استفاده تکراری یا سند متعلق به حساب دیگر رد می‌شود. این مسیر صرفاً نوع فایل را از امضای باینری بررسی می‌کند و اصالت مدرک هویتی را تأیید نمی‌کند.

`GET /documents/:id` با توکن مالک، باینری تصویر را برمی‌گرداند؛ URL عمومی برای مدارک وجود ندارد.

## ثبت‌نام مشتری

`POST /auth/customers/register` → 201

```json
{
  "fullName": "نام و نام خانوادگی",
  "phone": "09121234567",
  "password": "a-strong-password",
  "nationalId": "1234567891",
  "identityDocument": { "id": "UPLOAD_UUID", "token": "UPLOAD_TOKEN" },
  "vehicles": [
    {
      "name": "پژو ۲۰۶",
      "plate": "۱۲ب۳۴۵۶۷",
      "documents": [{ "id": "ANOTHER_UPLOAD_UUID", "token": "ANOTHER_UPLOAD_TOKEN" }]
    }
  ]
}
```

چهار فیلد اول اجباری است. `identityDocument` و `vehicles` و `documents` اختیاری‌اند؛ اگر سند ندارید فیلد آن را حذف کنید. کد ملی باید ۱۰ رقم با checksum صحیح باشد. ارقام فارسی/عربی در کد ملی و شماره تبدیل می‌شوند. شماره به قالب `09xxxxxxxxx` ذخیره می‌شود و `+98` نیز پذیرفته است.

## ثبت‌نام امدادگر

`POST /auth/drivers/register` → 201. تمام فیلدهای زیر اجباری‌اند:

```json
{
  "fullName": "نام و نام خانوادگی امدادگر",
  "phone": "09121234568",
  "password": "a-strong-password",
  "nationalId": "1234567891",
  "vehiclePlate": "۱۲ب۳۴۵۶۷",
  "vehicleType": "نیسان یدک‌کش",
  "services": ["REPAIR", "TOWING"],
  "identityDocument": { "id": "UPLOAD_UUID", "token": "UPLOAD_TOKEN" }
}
```

نقش را کلاینت نمی‌تواند تعیین کند؛ route آن را تعیین می‌کند. فیلدهای ناشناخته در payloadها رد می‌شوند.

## ورود و پروفایل

| متد و route | توضیح |
| --- | --- |
| `POST /auth/customers/login` | ورود مشتری |
| `POST /auth/drivers/login` | ورود امدادگر |
| `POST /auth/logout` | خروج session فعلی و قطع socketهای حساب |
| `GET /me` | پروفایل خود، خودروها و شناسه مدارک |
| `POST /me/vehicles` | افزودن خودرو برای مشتری با `name`, `plate`, `documents?` |
| `POST /me/identity-document` | اتصال/جایگزینی مدرک با `{id, token}` |

ورود هر دو نقش:

```json
{ "phone": "09121234567", "password": "a-strong-password" }
```

ورود و ثبت‌نام پاسخ مشابه دارند:

```json
{
  "token": "SESSION_TOKEN",
  "expiresAt": "2026-10-26T12:00:00.000Z",
  "user": { "id": "UUID", "role": "CUSTOMER", "fullName": "...", "phone": "09121234567" }
}
```

`user` فیلدهای پروفایل بیشتری نیز دارد، اما `passwordHash` هرگز برنمی‌گردد. ثبت‌نام موفق کاربر را وارد می‌کند. شماره یا کد ملی تکراری در همان نقش پاسخ 409 می‌دهد.

## ثبت حمل خودرو

فقط مشتری: `POST /requests/towing` → 201

```json
{
  "vehicleName": "پژو ۲۰۶",
  "vehiclePlate": "۱۲ب۳۴۵۶۷",
  "origin": { "latitude": 35.7000, "longitude": 51.4000 },
  "destination": { "latitude": 35.8000, "longitude": 51.5000 }
}
```

سرور مسیر را محاسبه می‌کند، هزینه را با تعرفه محیط حساب می‌کند و `distanceMeters`, `distanceMethod`, `priceToman`, `pricingVersion`, `createdAt` را در پاسخ و دیتابیس ذخیره می‌کند. `priceToman` یا فاصله ارسالی از کلاینت پذیرفته نمی‌شود. مختصات یکسان یا مسیر نامعتبر رد می‌شود. در خطای سرویس مسیر، درخواست ساخته نمی‌شود و پاسخ 503 است. کلاینت باید از ارسال تکراری هنگام انتظار پاسخ جلوگیری کند؛ idempotency key در این نسخه وجود ندارد.

## ثبت تعمیر در محل

فقط مشتری: `POST /requests/repair` → 201

```json
{
  "vehicleName": "پژو ۲۰۶",
  "vehiclePlate": "۱۲ب۳۴۵۶۷",
  "origin": { "latitude": 35.7000, "longitude": 51.4000 },
  "problem": "خودرو روشن نمی‌شود"
}
```

درخواست همراه `createdAt` ثبت می‌شود. مقصد ندارد؛ `priceToman` برابر ۸۰۰٬۰۰۰ تومان ورودی تعمیر است. هزینه قطعات پس از بررسی جداگانه محاسبه می‌شود و داخل ورودی نیست.

## دریافت و پذیرش درخواست

| متد و route | دسترسی و رفتار |
| --- | --- |
| `GET /requests?page=1` | درخواست‌های خود؛ صفحه‌های ۵۰تایی، جدیدترین ابتدا |
| `GET /requests/:id` | فقط مشتری سازنده یا امدادگر پذیرفته‌شده |
| `GET /drivers/requests/available` | امدادگر؛ حداکثر ۵۰ درخواست منتظر مطابق خدمات پروفایل، بدون کد ملی و اطلاعات تماس مشتری |
| `POST /requests/:id/accept` | امدادگر دارای خدمت مربوطه و GPS تازه؛ بدنه لازم نیست |
| `PATCH /requests/:id/status` | تغییر وضعیت با `{ "status": "ARRIVED" }` یا مقادیر مجاز زیر |
| `GET /requests/:id/tracking` | GPS و فاصله امدادگر، فقط طرفین درخواست فعال |

گردش وضعیت:

```text
PENDING --driver accepts--> ACCEPTED --assigned driver--> ARRIVED --assigned driver--> COMPLETED
PENDING --customer cancels--> CANCELLED
```

امدادگر پیش از پذیرش باید GPS تازه بفرستد. یک مأموریت فعال یعنی `ACCEPTED` یا `ARRIVED`. درخواست لغوشده یا تکمیل‌شده دیگر tracking ندارد. لغو پس از پذیرش و تخصیص خودکار/نزدیک‌ترین امدادگر در این فاز پیاده‌سازی نشده‌اند.

## GPS با REST

فقط امدادگر: `PUT /drivers/location`

```json
{
  "latitude": 35.7100,
  "longitude": 51.4100,
  "recordedAt": "2026-10-19T12:00:00.000Z"
}
```

`recordedAt` را در لحظه دریافت GPS با `new Date().toISOString()` بفرستید، نه مقدار نمونه بالا. پیشنهاد ارسال هر ۳ تا ۵ ثانیه در مأموریت فعال است. بدون دریافت GPS از دستگاه، سرور نمی‌تواند موقعیت را تولید کند.

پاسخ tracking و payload رویداد موقعیت:

```json
{
  "driver": { "latitude": 35.71, "longitude": 51.41, "recordedAt": "2026-10-19T12:00:00.000Z" },
  "distanceToOriginMeters": 1435,
  "distanceMethod": "POSTGIS_GEODESIC",
  "stale": false
}
```

پیش از پذیرش: `{ "driver": null }`. GPS منقضی/ناموجود بعد از پذیرش: `{ "driver": null, "stale": true }`.

## Socket.IO

از کلاینت Socket.IO نسخه ۴ استفاده کنید، اتصال WebSocket خام کافی نیست. آدرس socket دامنه اصلی است و `/api/v1` ندارد.

```js
import { io } from 'socket.io-client';

const socket = io('https://YOUR_API_DOMAIN', {
  auth: { token: sessionToken },
});

// سرور هر کاربر را فقط به room خصوصی خودش وارد می‌کند.
socket.on('driver:location', ({ requestId, driver, distanceToOriginMeters, stale }) => {
  // به‌روزرسانی نقشه و فاصله در اپ مشتری و امدادگر
});
socket.on('request:updated', request => {
  // به‌روزرسانی وضعیت؛ رویداد تکراری ممکن است.
});

// فقط امدادگر؛ حداکثر یک بار در ثانیه
socket.timeout(8000).emit('driver:location', {
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  recordedAt: new Date().toISOString(),
}, (err, ack) => {
  if (err || !ack.ok) { /* نمایش/مدیریت خطا */ }
});

// طرفین می‌توانند snapshot را نیز دریافت کنند.
socket.emit('request:tracking', { requestId }, ack => {
  if (ack.ok) console.log(ack.data);
});

socket.on('connect', async () => {
  // پس از reconnect، لیست و tracking درخواست فعال را با REST دوباره بخوانید.
});
```

GPS ارسالی از REST نیز همان رویداد Socket.IO را به هر دو طرف می‌فرستد. مشتری اجازه ارسال GPS امدادگر ندارد. اشتراک در room دلخواه یا دریافت GPS تمام امدادگرها API ندارد. session برای هر event بررسی می‌شود و اتصال‌های بی‌کار نیز دوره‌ای بازبینی می‌شوند.

## خطاها و محدودیت‌ها

فرمت: `{ "error": "message", "issues": [] }`؛ `issues` فقط برای خطای اعتبارسنجی است.

| کد | معنی |
| --- | --- |
| 400 | payload، مختصات، کد ملی، سند یا زمان GPS نامعتبر |
| 401 | ورود نامعتبر، توکن منقضی یا مفقود |
| 403 | نقش نامناسب |
| 404 | منبع پیدا نشد یا متعلق به کاربر نیست |
| 409 | حساب تکراری، رقابت پذیرش، مأموریت فعال، ترتیب GPS یا تغییر وضعیت غیرمجاز |
| 429 | محدودیت درخواست؛ `Retry-After` را رعایت کنید |
| 503 | مسیریابی یا زیرساخت آماده نیست |

حدود فعلی: ۳۰۰ درخواست API در دقیقه/IP، ۱۰ ورود در ۱۵ دقیقه/IP، ۱۰ ثبت‌نام و آپلود در ساعت/IP، ۲۰ ثبت درخواست در ساعت/کاربر، ۱۲۰ GPS از REST در دقیقه/امدادگر و ۱ GPS در ثانیه از socket. در reverse proxy تنظیم صحیح `TRUST_PROXY` لازم است.

Health: `GET /health/live` و `GET /health/ready` بیرون از `/api/v1` هستند.


قرارداد جدید نوع حمل، شرایط ویژه، snapshot تعرفه و ورود با کوکی در [راهنمای تعرفه و نشست](TARIFFS-AND-SESSIONS.md) آمده است.

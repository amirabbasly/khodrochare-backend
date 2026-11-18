# جمعه‌بازار بدون پنل ادمین

تنها سه پوشه `khodrochare-backend`، `khodrochare-app` و `khodrochare-driver` نیاز به انتشار دارند. ورود ادمین، ساخت حساب ادمین و اجرای اپ ادمین برای دریافت و نمایش محصولات لازم نیست.

## مسیرهای فرانت

- مشتری: `https://app.khodrochare.ir/market`
- امدادگر: `https://driver.khodrochare.ir/market` (با دامنه واقعی اپ امدادگر جایگزین کنید).
- دکمه‌های موجود در داشبورد `/home` همچنان همان فروشگاه را باز می‌کنند.
- API عمومی: `https://api.khodrochare.ir/api/v1/market/products?limit=1`؛ بدون احراز هویت.

قبلاً صفحه مستقل `/market` در دو اپ وجود نداشت و فروشگاه فقط یک view داخل داشبورد بود. اکنون فایل `src/app/market/page.tsx` در هر دو اپ اضافه شده؛ برای رفع 404 باید تصویر فرانت جدید build و جایگزین شود. تغییر Nginx به‌تنهایی مسیر Next.js ایجاد نمی‌کند.

## تنظیمات بک‌اند

در `/opt/khodrochare-backend/.env`، فقط متغیرهای زیر را اضافه یا ویرایش کنید. فایل موجود را با `.env.example` جایگزین نکنید؛ مشخصات PostgreSQL، Redis، نشست‌ها، زرین‌پال و تنظیمات مالی را نگه دارید.

```dotenv
TOROB_ENABLED=true
TOROB_CHROME_PATH=/usr/bin/chromium
TOROB_BROWSER_NO_SANDBOX=true
TOROB_INTERVAL_MINUTES=360
TOROB_MAX_SCROLLS=1000
TOROB_MAX_PRODUCTS=10000
TOROB_SCROLL_WAIT_MS=2000
TOROB_IDLE_ROUNDS=8
TOROB_SCAN_TIMEOUT_MS=1800000
TOROB_PRICE_TTL_HOURS=24
TOROB_SOURCES_JSON='[{"name":"باتری خودرو","url":"https://torob.com/browse/541/","category":"batteries","active":true}]'
```

JSON باید یک خط فیزیکی و در کوتیشن تکی باشد. می‌توانید چند شیء با کاما در همان آرایه بگذارید. هر شیء یک لینک دسته واقعی ترب دارد و می‌تواند `intervalMinutes`، `maxScrolls`، `maxProducts`، `scrollWaitMs` و `idleRounds` را جداگانه تعیین کند. `category` باید slug موجود، مثلاً `batteries` یا `auto-parts` باشد. دسته واقعی محصول از breadcrumb ترب استخراج می‌شود؛ این مقدار دسته fallback است و مجوز انتشار کالای غیرخودرویی نیست.

حدود: فاصله دریافت ۱۵ تا ۴۳۲۰۰ دقیقه؛ اسکرول ۱ تا ۱۰۰۰۰؛ محصول ۱ تا ۱۰۰۰۰۰؛ انتظار اسکرول ۱۵۰۰ تا ۱۰۰۰۰ میلی‌ثانیه؛ پایان پس از ۳ تا ۳۰ دور بدون نتیجه در پایین صفحه. لینک تکراریِ یک دسته و JSON خراب رد می‌شوند.

اگر `TOROB_SOURCES_JSON` وجود نداشته باشد، متغیر قدیمی `TOROB_INITIAL_CATEGORY_URL` یک منبع فعال می‌سازد؛ پیش‌فرض آن دسته باتری ۵۴۱ است. اگر JSON وجود دارد، بر لینک اولیه اولویت دارد. مقدار خالی JSON معتبر نیست؛ `TOROB_SOURCES_JSON='[]'` همه منابع را غیرفعال می‌کند.

فهرست env مرجع منابع است: منبع جدید ساخته می‌شود، تنظیمات تغییرکرده اعمال می‌شوند و منابع حذف‌شده از فهرست غیرفعال می‌شوند. ردیف‌ها، محصولات، قیمت‌ها و تاریخچه پاک نمی‌شوند، ولی محصولی که هیچ منبع فعال ندارد در فهرست عمومی نمایش داده نمی‌شود. `TOROB_ENABLED=false` دریافت را متوقف و منابع را غیرفعال می‌کند؛ این گزینه نگه‌داشتن محصولات در ویترین با قیمت منقضی نیست.

تنظیمات هنگام شروع Worker خوانده می‌شوند. پس از تغییر `.env` باید کانتینر بازآفرینی شود؛ `docker compose restart` محیط کانتینر موجود را به‌روزرسانی نمی‌کند. Worker خودکار bootstrap می‌کند و هر ۱۰ ثانیه کارهای موعدرسیده را صف‌بندی می‌کند. دکمه شروع لازم نیست. راه‌اندازی مجدد بدون تغییر تنظیمات، وضعیت پیشرفت و cooldown را حفظ می‌کند.

## سازگاری فنی اختیاری از env

فهرست مدل‌ها و ادعاهای سازگاری خود ترب خودکار وارد می‌شوند. برای قواعد دستی، متغیر اختیاری `TOROB_COMPATIBILITY_RULES_JSON` آرایه‌ای از شیءهای زیر می‌گیرد؛ در `.env` آن را به یک خط تبدیل کنید:

```json
{
  "name": "نام یکتای قاعده مستند",
  "category": "batteries",
  "carKeys": ["کلید واقعی خودرو از خروجی market-status"],
  "requirements": {"capacityAh":60,"voltage":12,"caseCode":"L2","polarity":"LEFT","technology":"WET","lengthMm":242,"widthMm":175,"heightMm":190},
  "evidenceUrl": "https://manufacturer.example/actual-specification",
  "verified": false,
  "checkedAt": "2026-11-18T00:00:00.000Z",
  "expiresAt": "2027-05-18T00:00:00.000Z"
}
```

این نمونه صرفاً ساختار تنظیمات است؛ کلید خودرو و مرجع آن واقعی نیستند و نباید عیناً فعال شود. فقط پس از تطبیق مستند همه مشخصات، `verified=true` بگذارید. برابری آمپرساعت به‌تنهایی کافی نیست. کلید خودرو باید در دیتابیس باشد؛ تاریخ مرجع نباید آینده و تاریخ انقضا نباید گذشته باشد. نام قاعده در همین فهرست یکتا است.

وقتی متغیر قواعد وجود دارد، قواعد با نام همگام می‌شوند و قواعد حذف‌شده از فهرست غیرفعال می‌شوند؛ ردیف‌ها حذف نمی‌شوند. `[]` قواعد دستی را غیرفعال می‌کند. نبود متغیر، قواعد قبلی را دست نمی‌زند. رابطه سازگاری محصول در دریافت بعدی همان محصول بازسازی می‌شود؛ تغییر env به معنی به‌روزرسانی فوری سازگاری محصولات قبلاً دریافت‌شده نیست. رفع پرچم قیمت مشکوک در این نسخه خودکار نشده است؛ پرچم عمداً با ری‌استارت حذف نمی‌شود.

## انتشار بک‌اند و Worker روی سرور موجود

کد جدید پوشه بک‌اند را در مسیر موجود بارگذاری کنید؛ فایل `.env`، پروژه Compose و نام volumeهای قبلی را حفظ کنید. هیچ migration جدیدی برای این تغییر لازم نیست؛ migration قبلی `202611180002_torob_native` باید اجرا شده باشد.

بک‌آپ اختیاری ولی توصیه‌شده، بدون توقف سرویس:

```sh
cd /opt/khodrochare-backend
umask 077
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "postgres-backup-$(date +%Y%m%d-%H%M%S).dump"
```

انتشار با فرض اینکه PostgreSQL و Redis فعلی در حال اجرا هستند:

```sh
cd /opt/khodrochare-backend
docker compose build api market-worker
docker compose up -d --no-deps api market-worker
docker compose ps
docker compose logs --since=10m --tail=200 api market-worker
curl -fsS http://127.0.0.1:4000/health/ready
docker compose exec -T market-worker node scripts/market-status.js
curl -fsS 'https://api.khodrochare.ir/api/v1/market/products?limit=1'
```

اگر فقط `.env` عوض شده و تصویر جدید قبلاً ساخته شده است:

```sh
cd /opt/khodrochare-backend
docker compose up -d --no-deps --force-recreate market-worker
```

اگر CORS، زرین‌پال یا سایر تنظیمات API را تغییر داده‌اید، `api` را هم به دستور بالا اضافه کنید. `.env` به‌تنهایی محتویات تصویر قدیمی را تغییر نمی‌دهد.

## انتشار دو فرانت

مسیر ریشه فرانت‌ها روی سرور اعلام نشده است. اگر طبق ساختار مخزن، فایل موجود `compose.market.yaml` در `/opt/khodrochare-application` است، پس از بارگذاری دو پوشه فرانت جدید:

```sh
cd /opt/khodrochare-application
PUBLIC_API_URL=https://api.khodrochare.ir/api/v1 docker compose -f compose.market.yaml build customer driver
docker compose -f compose.market.yaml up -d --no-deps customer driver
curl -I http://127.0.0.1:3100/market
curl -I http://127.0.0.1:3101/market
curl -I https://app.khodrochare.ir/market
```

این دستورها ادمین را build یا اجرا نمی‌کنند. اگر فرانت‌ها را با Compose دیگری اجرا کرده‌اید، همان فایل و نام سرویس‌های موجود را استفاده کنید؛ کانتینر موازی با پورت تکراری نسازید. متغیر فرانت `NEXT_PUBLIC_API_BASE_URL` هنگام **build** وارد JS می‌شود؛ فقط تغییر env زمان اجرا کافی نیست. در Compose مخزن، `PUBLIC_API_URL` به این build-arg متصل است. Dockerfileهای هر دو فرانت پیش‌فرض API صحیح دارند. کلیدهای محرمانه بک‌اند را در متغیرهای `NEXT_PUBLIC_*` قرار ندهید.

## پراکسی

با Compose فرانت موجود، نگاشت‌ها چنین‌اند: دامنه مشتری → `127.0.0.1:3100`، دامنه امدادگر → `127.0.0.1:3101`، API → `127.0.0.1:4000`. روی دامنه اپ، تمام مسیرها از جمله `/market` و `/_next/` باید به همان Next.js پروکسی شوند. روی دامنه API، پیشوند `/api/v1` نباید حذف یا دوبار اضافه شود. `CORS_ORIGINS` بک‌اند باید origin دقیق دو اپ را شامل شود. مقدار فعلی Nginx سرور از این محیط قابل مشاهده نیست.

برای بررسی بدون تغییر:

```sh
sudo nginx -t
sudo nginx -T 2>&1 | grep -E 'server_name|location|proxy_pass|try_files'
```

اگر localhost هم برای `/market` پاسخ 404 داد، ابتدا تصویر فرانت و فایل route را بررسی کنید. اگر localhost پاسخ صحیح ولی دامنه 404 داد، upstream یا CDN/کش را بررسی کنید. Nginx و Caddy را هم‌زمان روی پورت‌های ۸۰/۴۴۳ اجرا نکنید.

## وضعیت، صف و علت خالی بودن فروشگاه

```sh
cd /opt/khodrochare-backend
docker compose exec -T market-worker node scripts/market-status.js
docker compose logs --since=12h --tail=500 market-worker
```

اسکریپت اول فقط خواندنی است: تعداد همه محصولات ذخیره‌شده، محصولات ترب، محصولات قابل نمایش با همان شرط API، پیشنهادهای موجود و تازه، وضعیت هر منبع، نسل و وضعیت لینک‌ها، صف‌های BullMQ، heartbeat و ثانیه‌های cooldown را نشان می‌دهد. `cars` کلیدهای مدل/تیپ را برای قواعد env می‌دهد. گذرواژه‌ها و آدرس اتصال دیتابیس چاپ نمی‌شوند. تعداد پیشنهادها در این گزارش خام است؛ شمارش فروشنده یکتا در هر کارت جدا محاسبه می‌شود.

- `torob_env_configured`: تنظیمات خوانده و همگام شدند؛ تعداد منابع فعال را ببینید.
- `torob_scheduler_status`: هر حدود ۶۰ ثانیه، وضعیت منابع و `backoffSeconds`؛ Healthy فقط زنده بودن Worker را نشان می‌دهد.
- `torob_scan_started` و `torob_links_collected`: شروع مرورگر و تعداد لینک، سقف و کامل/ناقص بودن پیمایش.
- `torob_failure`: کد خطا، `httpStatus`، `url` بدون query، `stage` و `nextRunAt`؛ جزئیات افزوده فقط برای خطاهای رخ‌داده بعد از این نسخه موجودند.
- HTTP درخواست محصول یا robots: ۴۰۱/۴۰۳ → `SOURCE_ACCESS_DENIED`، ۴۲۹ → `SOURCE_RATE_LIMITED`، ۴۹۰ → `SOURCE_CHALLENGE`. مرورگر نیز پاسخ دسته و endpointهای اصلی داده ترب را بررسی می‌کند. در نسخه جدید، ۴۲۹ ناوبری به‌درستی rate-limit گزارش می‌شود.
- این خطاها حداقل شش ساعت cooldown مشترک ایجاد می‌کنند. پس از پایان، ادامه دریافت خودکار است. ری‌استارت یا دکمه شروع این محدودیت را حذف نمی‌کند. CAPTCHA و محدودیت دسترسی دور زده نمی‌شوند؛ دسترسی به ترب از سرور تضمین نشده است.
- اگر لینک ثبت شده ولی مرحله جمع‌آوری هنوز `RUNNING` یا `BLOCKED` است، HTTP محصولات آغاز نمی‌شود؛ این دو مرحله به‌ترتیب اجرا می‌شوند.
- اگر محصول ذخیره شده ولی `publishedProducts=0` است، فعال بودن منبع/محصول/برند/دسته، پرچم مشکوک و انقضای قیمت را بررسی کنید. قیمت‌ها پیش‌فرض ۲۴ ساعت اعتبار دارند.
- API ادمین بدون نشست ۴۰۱ می‌دهد؛ برای این روش نیازی به آن API نیست و خطای آن جلوی Worker را نمی‌گیرد.

این تغییر صفِ کارهای تمام‌شده‌ای را هم که لینکشان هنوز PENDING است برای ادامه همان لینک آماده می‌کند؛ صف‌ها به‌طور کلی پاک نمی‌شوند. دیتابیس تولید، کاربران، تراکنش‌ها و تنظیمات مالی بازنشانی نمی‌شوند.

## اعتبارسنجی انجام‌شده

تست‌های Node و lint/TypeScript دو اپ اجرا می‌شوند؛ گزارش نهایی اجرا را در پاسخ تغییر ببینید. Docker در محیط توسعه فعلی موجود نیست، بنابراین build Docker، migration و تست مرورگر/دیتابیس واقعی این نسخه اجرا نشده‌اند. موفقیت تست‌های کنترل‌شده، تضمین دریافت کامل دسته‌های ترب از IP سرور نیست.

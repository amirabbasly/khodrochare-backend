# تغییر دریافت محصولات در ۱۸ نوامبر ۲۰۲۶

بخش‌های اتصال چندمنبعی و API جست‌وجوی قدیمی این راهنما بازنشسته شده‌اند. برای crawler فقط از [راهنمای فعلی ترب](README.md) استفاده کنید. تنظیم دامنه و Nginx زیر همچنان کاربرد دارد.

# استقرار روی سرور و فعال‌سازی استخراج واقعی

**به‌روزرسانی ۱۴ نوامبر:** مسیر عمومی ترب اکنون پس از دیپلوی به‌صورت خودکار شروع می‌شود و ثبت دستی منبع برای آن لازم نیست. [تنظیمات و محدودیت‌های دریافت ترب](TOROB-LIVE.md) را ببینید. مراحل ثبت منبع در این راهنما برای feed/API همکاری فروشگاه‌ها هستند.

این راهنما برای سرور Ubuntu 24.04، Docker Engine و Compose plugin است. مسیر نمونه پروژه `/opt/khodrochare-application` است. دامنه‌های نمونه اپ‌ها را با دامنه واقعی خود جایگزین کنید؛ API همان `api.khodrochare.ir` است.

## تفاوت استقرار با اتصال منبع

استقرار، API، دیتابیس، Redis، Worker و اپ‌ها را روشن می‌کند. استخراج واقعی نیازمند منبع مجاز، آدرس دقیق feed/API یا صفحه پشتیبانی‌شده و پیکربندی آداپتر است. فعال‌کردن یک URL دلخواه به معنی پشتیبانی از آن سایت نیست. Torob/Divar/Digikala در فهرست آداپترهای منابع، قرارداد feed همکاری دارند. ترب علاوه بر آن، مسیر عمومی جست‌وجو با ذخیره قیمت مرجع دارد؛ استخراج تمام فروشندگان و دسترسی پایدار آن تأیید نشده است. هیچ تضمینی برای دریافت «تمام اطلاعات همه منابع» وجود ندارد. اتصال واقعی هر منبع باید با قرارداد و نمونه داده همان منبع تست شود.

## ۱. آماده‌سازی

Docker را از راهنمای رسمی نصب کنید: https://docs.docker.com/engine/install/ubuntu/ . Compose plugin نیز باید نصب باشد. برای شروع کم‌ترافیک، ۴ هسته و ۸ گیگابایت RAM یک برآورد اولیه است؛ تضمین ظرفیت نیست. فضای دیسک به تعداد snapshotها و تصاویر آپلودی بستگی دارد.

کدها را در مسیر پروژه بارگذاری کنید. `.env` موجود و داده‌های سرور را هنگام به‌روزرسانی جایگزین نکنید. این راهنما نیاز به نصب Node، PostgreSQL یا Redis روی خود میزبان ندارد.

```sh
cd /opt/khodrochare-application
sudo docker version
sudo docker compose version

# فقط برای اولین نصب؛ اگر .env موجود باشد، حفظ می‌شود.
sudo docker run --rm \
  --mount type=bind,src="$PWD/khodrochare-backend",dst=/app \
  -w /app node:22-bookworm-slim node scripts/setup-env.js

sudo chmod 600 khodrochare-backend/.env
sudo nano khodrochare-backend/.env
```

مقادیر زیر را در فایل بک‌اند تنظیم کنید. نام دامنه اپ‌ها در این مثال پیشنهادی است:

```dotenv
API_DOMAIN=api.khodrochare.ir
API_BIND_ADDRESS=127.0.0.1
API_PORT=4000
CORS_ORIGINS=https://app.khodrochare.ir,https://driver.khodrochare.ir,https://admin.khodrochare.ir
TRUST_PROXY=1
DISTANCE_MODE=road
MARKET_RAW_RETENTION_DAYS=180
MARKET_ARCHIVE_RETENTION_DAYS=1095
```

`TRUST_PROXY=1` در این راهنما برای یک reverse proxy مستقیم روی همین سرور است. اگر CDN یا چند پراکسی دارید، آن را متناسب با زنجیره واقعی تنظیم کنید. پسوردهای تصادفی دیتابیس و Redis را که اسکریپت ایجاد کرده حفظ کنید. تغییر صرف پسورد در `.env`، پسورد دیتابیس موجود را تغییر نمی‌دهد.

مسیریابی و جست‌وجوی آدرس به OSRM و Photon متکی‌اند؛ مقادیر پیش‌فرض عمومی برای تضمین ترافیک تولید مناسب نیستند. برای تولید، سرویس اختصاصی یا ارائه‌دهنده دارای ظرفیت و مجوز تعیین کنید.

## ۲. آزمون قبل از استقرار

```sh
cd /opt/khodrochare-application/khodrochare-backend
sudo docker build --target test -t khodrochare-unit .
sudo docker compose -p khodrochare-test -f compose.yaml -f compose.test.yaml \
  up --build --abort-on-container-exit --exit-code-from api

# فقط منابع پروژه آزمایشی؛ هیچ down -v روی پروژه تولید اجرا نکنید.
sudo docker compose -p khodrochare-test -f compose.yaml -f compose.test.yaml down -v

cd /opt/khodrochare-application
sudo docker build -f Dockerfile.e2e -t khodrochare-e2e .
sudo docker run --rm --init --ipc=host khodrochare-e2e
```

اگر هر مرحله شکست خورد، خطا باید پیش از انتشار بررسی شود. این مراحل در محیط توسعه فعلی به علت نبود Docker اجرا نشده‌اند؛ گزارش [VALIDATION.md](VALIDATION.md) را ببینید.

## ۳. اجرای بک‌اند

```sh
cd /opt/khodrochare-application/khodrochare-backend
sudo docker compose build api market-worker

# ساخت ورود ادمین؛ .env میزبان به‌روزرسانی می‌شود.
sudo docker compose run --rm --no-deps \
  --user 0:0 -e NODE_PATH=/app/node_modules \
  --mount type=bind,src="$PWD",dst=/workspace \
  --workdir /workspace api node scripts/setup-admin.js

# حساب ادمین در این فایل محلی است؛ آن را منتشر نکنید.
sudo chmod 600 .env
if sudo test -f ADMIN-CREDENTIALS.txt; then sudo chmod 600 ADMIN-CREDENTIALS.txt; fi

sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs --tail=100 api market-worker
curl --fail http://127.0.0.1:4000/health/ready
```

Migration هنگام راه‌اندازی API اجرا می‌شود. Worker بعد از healthy شدن API شروع می‌شود. فایل `ADMIN-CREDENTIALS.txt` را فقط با دسترسی امن میزبان بخوانید؛ اگر قبلاً حساب ادمین تنظیم شده، اسکریپت آن را حفظ می‌کند و ممکن است این فایل تازه ساخته نشود.

## ۴. اجرای سه اپ

```sh
cd /opt/khodrochare-application
sudo docker compose -f compose.market.yaml up -d --build
sudo docker compose -f compose.market.yaml ps
```

پورت‌های داخلی میزبان: مشتری `3100`، امدادگر `3101`، ادمین `3102` و API `4000`. آدرس پیش‌فرض API اپ‌ها `https://api.khodrochare.ir/api/v1` است. اگر دامنه API فرق می‌کند، قبل از build متغیر `PUBLIC_API_URL` و برای ادمین `ADMIN_API_BASE_URL` را در فایل `.env` ریشه سه اپ تنظیم کنید؛ این فایل با `.env` پوشه بک‌اند متفاوت است.

## ۵. دامنه و HTTPS با Nginx

رکورد DNS هر چهار دامنه را به IP سرور وصل کنید. پورت‌های ۸۰ و ۴۴۳ قابل دسترس باشند. دیتابیس، Redis و پورت‌های داخلی اپ‌ها را عمومی نکنید.

این روش از Nginx میزبان استفاده می‌کند؛ هم‌زمان `compose.edge.yaml` را اجرا نکنید، چون Caddy و Nginx هر دو به پورت ۸۰/۴۴۳ نیاز دارند. اگر وب‌سرور موجود دارید، همین upstreamها را در آن تنظیم کنید.

نمونه فایل `/etc/nginx/sites-available/khodrochare`:

```nginx
server {
    listen 80;
    server_name api.khodrochare.ir;
    client_max_body_size 15m;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 75s;
        proxy_buffering off;
    }
}
server {
    listen 80;
    server_name app.khodrochare.ir;
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
server {
    listen 80;
    server_name driver.khodrochare.ir;
    location / {
        proxy_pass http://127.0.0.1:3101;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
server {
    listen 80;
    server_name admin.khodrochare.ir;
    location / {
        proxy_pass http://127.0.0.1:3102;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

پس از نصب Nginx و Certbot با روش مناسب توزیع خود، فایل را در `sites-enabled` فعال کنید، `sudo nginx -t` را اجرا کنید و سپس سرویس را reload کنید. با افزونه Nginx گواهی بگیرید:

```sh
sudo certbot --nginx \
  -d api.khodrochare.ir -d app.khodrochare.ir \
  -d driver.khodrochare.ir -d admin.khodrochare.ir
sudo certbot renew --dry-run
curl --fail https://api.khodrochare.ir/health/ready
curl --fail 'https://api.khodrochare.ir/api/v1/market/products?page=1&limit=10'
```

قبل از ورود کاربران، HTTPS هر چهار دامنه را فعال کنید؛ نشست‌های امن و دسترسی GPS به آن وابسته‌اند.

## ۶. اتصال اولین منبع واقعی

۱. با حساب ادمین وارد `https://admin.khodrochare.ir` شوید و صفحه `/market` را باز کنید.

۲. دسته‌های اولیه با migration ساخته می‌شوند. کاتالوگ، برند و خودرو از داده منبع به‌صورت خودکار ایجاد می‌شوند؛ ثبت دستی قطعه مادر اجباری نیست. محصول آزمایشی در تولید ساخته نمی‌شود.

۳. منبع را ابتدا غیرفعال اضافه کنید. آداپتر باید با نوع داده همان منبع سازگار باشد:

- `json-feed`: API/feed استاندارد همکاری با خروجی `items` و `next`.
- `woocommerce`: محصولات Store API فروشگاه مجاز.
- `jsonld`: صفحه محصول دارای schema.org یا product sitemap پشتیبانی‌شده؛ برای هر قالب HTML دلخواه مناسب نیست.
- `torob`، `divar` و `digikala`: فعلاً همان قرارداد feed همکاری؛ نامشان به معنی اتصال آماده به سایت اصلی نیست.

۴. `baseUrl`، `allowedHosts`، `config.path`، مرجع مجوز و تاریخ اعتبار را از اطلاعات واقعی تأمین‌کننده وارد کنید. هیچ endpoint یا مجوزی را حدس نزنید. نمونه قرارداد دقیق در [README.md](README.md) و fixture تست وجود دارد.

۵. اگر کلید لازم است، تنها در `.env` بک‌اند وارد کنید:

```dotenv
MARKET_SECRET_SUPPLIER=REAL_TOKEN
MARKET_SECRET_SUPPLIER_HOST=api.real-supplier.ir
```

در فرم منبع `secretEnv` را `MARKET_SECRET_SUPPLIER` قرار دهید؛ host باید دقیقاً با host درخواست همخوان باشد. سپس تنظیمات محیط Worker را بارگذاری مجدد کنید:

```sh
cd /opt/khodrochare-application/khodrochare-backend
sudo docker compose up -d --force-recreate market-worker
```

۶. منبع را فعال کنید و دریافت دستی بزنید. وضعیت run، خطاها و listingها را در پنل بررسی کنید. Worker زمان‌بندی بعدی را خودکار انجام می‌دهد و در رسیدن به سقف صفحات، اجرای بعدی از cursor ذخیره‌شده ادامه می‌یابد.

۷. تأیید دستی فروشنده لازم نیست. رکوردهای کامل به‌صورت خودکار گروه‌بندی و داده‌های ناقص به‌صورت محصول مستقل منتشر می‌شوند. قیمت مشکوک، منبع غیرفعال یا پیشنهاد منقضی نمایش داده نمی‌شود. قیمت و موجودی را پس از اولین دریافت نمونه‌برداری کنید.

۸. محصول را در هر دو اپ بررسی کنید: قیمت به تومان، موجودی، هزینه ارسال، زمان دریافت، لینک فروشنده و تاریخچه. یک هشدار آزمایشی برای حساب خود ثبت کنید. پیامک تنها پس از تنظیم سرویس پیامک مجاز قابل استفاده است.

## ۷. نگهداری و رفع خطا

```sh
cd /opt/khodrochare-application/khodrochare-backend
sudo docker compose ps
sudo docker compose logs --tail=200 market-worker
sudo docker compose logs --tail=200 api

# خروجی قیمت‌های عمومی
curl --fail 'https://api.khodrochare.ir/api/v1/market/products?limit=10'

# بک‌آپ دیتابیس؛ فایل را خارج از سرور هم نگه دارید.
sudo docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > khodrochare-backup.dump
```

از volume فایل‌های آپلود و فایل‌های محیطی نیز بک‌آپ امن بگیرید. برای به‌روزرسانی، پس از بک‌آپ و دریافت کد جدید، دستورهای `up -d --build` بک‌اند و سه اپ را دوباره اجرا کنید. هیچ `down -v` برای تولید اجرا نکنید.

- `SOURCE_PERMISSION_REQUIRED`: منبع غیرفعال یا مجوز منقضی است.
- `SOURCE_SECRET_MISSING` یا `SOURCE_SECRET_HOST_NOT_BOUND`: متغیرهای محیطی و host را اصلاح و Worker را recreate کنید.
- `INVALID_FEED_JSON` یا خطای listing: خروجی منبع با قرارداد آداپتر سازگار نیست؛ لاگ run را بررسی کنید.
- داده دریافت می‌شود ولی قیمت دیده نمی‌شود: تطبیق، فعال بودن فروشنده، موجودی، زمان اعتبار، فعال بودن منبع و پرچم مشکوک را بررسی کنید.
- API بالا نمی‌آید: ابتدا لاگ migration، سلامت PostgreSQL و Redis را بررسی کنید؛ volume یا دیتابیس موجود را برای رفع خطا حذف نکنید.

برای پایدار بودن تولید، منابع باید جداگانه آزمایش شوند؛ دریافت میلیون‌ها کالا یا تمام صفحات سایت‌های نامشخص در این نسخه آزموده نشده است.

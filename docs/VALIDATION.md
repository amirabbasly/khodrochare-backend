# نتیجه اعتبارسنجی

محیط بررسی: Windows، Node.js 24.12.0؛ هدف ایمیج Docker، Node.js 22 روی Debian است.

انجام‌شده:

- ۱۳ تست موفق با `npm test`: اعتبارسنجی اطلاعات ثبت‌نام، checksum کد ملی، نقش مستقل، اطلاعات اجباری امدادگر، رمزهای scrypt، محاسبه تعرفه، محافظت مسیرهای HTTP، محرمانگی اسناد و خطاها، انقضا و ابطال session، مالکیت درخواست، GPS قدیمی/خارج از ترتیب و خطای مسیریابی.
- تست Socket.IO با کلاینت و سرور واقعی در همین محیط: رد اتصال بدون توکن، رد ارسال موقعیت توسط مشتری، دریافت در room خصوصی و قطع session باطل‌شده. سرویس دیتابیس و Redis در این تست جایگزین آزمایشی دارند.
- `prisma validate`: موفق.
- `prisma generate`: موفق؛ کلاینت Prisma ساخته و load شد.
- migration اولیه از schema با `prisma migrate diff --from-empty` تولید شد؛ فعال‌سازی PostGIS، indexهای GiST، محدودیت مختصات و index یکتای مأموریت فعال به آن اضافه شدند.
- `npm audit`: صفر آسیب‌پذیری گزارش‌شده پس از اصلاح Multer و override وابستگی `deepmerge-ts` به نسخه ۸. CLI Prisma با override اعتبارسنجی و اجرا شد.
- نصب تمیز با `npm ci --ignore-scripts` و تولید مجدد Prisma موفق بود؛ پس از نصب تمیز نیز هر ۱۳ تست و `prisma validate` دوباره موفق شدند.
- بررسی syntax فایل‌های اجرایی و تست یکپارچه: موفق.

انجام‌نشده در این محیط:

- Docker/Podman در دسترس نیست؛ بنابراین build ایمیج، `docker compose up`، اجرای SQL migration روی PostgreSQL واقعی و تست یکپارچه PostgreSQL/PostGIS/Redis/BullMQ اجرا نشده‌اند.
- تست یکپارچه بدون `RUN_INTEGRATION=1` عمداً skip می‌شود؛ skip به معنی موفقیت سناریوی واقعی نیست. دستور اجرای آن با volumeهای جدا در README آمده است.
- تماس واقعی با OSRM، صحت پوشش جاده‌های ایران، صدور گواهی HTTPS و اتصال صفحات دو اپ روی سرور بررسی نشده‌اند. دامنه، originها و تعرفه واقعی باید در `.env` تنظیم شوند.

منابع رسمی استفاده‌شده برای سازگاری PostGIS و محدودکردن ارتباط زنده:

- [Prisma و queryهای PostGIS](https://docs.prisma.io/docs/orm/prisma-client/using-raw-sql/safeql)
- [Socket.IO middleware](https://socket.io/docs/v4/middlewares)
- [Socket.IO rooms](https://socket.io/docs/v4/rooms/)

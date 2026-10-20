-- AlterTable
ALTER TABLE "AssistanceRequest" ADD COLUMN     "destinationAddress" TEXT,
ADD COLUMN     "originAddress" TEXT,
ADD COLUMN     "partsApprovedAt" TIMESTAMP(3),
ADD COLUMN     "partsApprovedToman" INTEGER,
ADD COLUMN     "partsQuoteToman" INTEGER,
ADD COLUMN     "partsQuoteVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vehicleModelId" TEXT;

-- CreateTable
CREATE TABLE "TariffGroup" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "nissanBaseToman" INTEGER,
    "nissanPerKmToman" INTEGER,
    "flatbedBaseToman" INTEGER,
    "flatbedPerKmToman" INTEGER,
    "version" TEXT NOT NULL,

    CONSTRAINT "TariffGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "aliases" TEXT[],
    "searchText" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "VehicleModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_TRANSFER',
    "serviceToman" INTEGER NOT NULL,
    "partsToman" INTEGER NOT NULL,
    "amountToman" INTEGER NOT NULL,
    "commissionPercent" INTEGER NOT NULL,
    "commissionToman" INTEGER NOT NULL,
    "driverShareToman" INTEGER NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "bankReference" TEXT NOT NULL,
    "transferredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNote" TEXT,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverEarning" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amountToman" INTEGER NOT NULL,
    "commissionToman" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverEarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleModel_normalizedName_key" ON "VehicleModel"("normalizedName");

-- CreateIndex
CREATE INDEX "VehicleModel_groupId_idx" ON "VehicleModel"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_requestId_key" ON "Payment"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_bankReference_key" ON "PaymentAttempt"("bankReference");

-- CreateIndex
CREATE INDEX "PaymentAttempt_paymentId_createdAt_idx" ON "PaymentAttempt"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriverEarning_paymentId_key" ON "DriverEarning"("paymentId");

-- CreateIndex
CREATE INDEX "DriverEarning_driverId_createdAt_idx" ON "DriverEarning"("driverId", "createdAt");

-- AddForeignKey
ALTER TABLE "AssistanceRequest" ADD CONSTRAINT "AssistanceRequest_vehicleModelId_fkey" FOREIGN KEY ("vehicleModelId") REFERENCES "VehicleModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleModel" ADD CONSTRAINT "VehicleModel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TariffGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AssistanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Initial vehicle groups and aliases from the supplied tariff reference.
ALTER TABLE "Payment" ADD CONSTRAINT "payment_money_valid" CHECK (
  "serviceToman" >= 0 AND "partsToman" >= 0 AND "amountToman" > 0
  AND "amountToman" = "serviceToman" + "partsToman"
  AND "commissionToman" >= 0 AND "driverShareToman" >= 0
  AND "commissionToman" + "driverShareToman" = "amountToman"
  AND "commissionPercent" IN (20,30)
);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_status_valid" CHECK (status IN ('AWAITING_TRANSFER','SUBMITTED','VERIFIED','REJECTED'));
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "attempt_status_valid" CHECK (status IN ('SUBMITTED','APPROVED','REJECTED'));
ALTER TABLE "AssistanceRequest" ADD CONSTRAINT "parts_amount_valid" CHECK (("partsQuoteToman" IS NULL OR "partsQuoteToman" >= 0) AND ("partsApprovedToman" IS NULL OR "partsApprovedToman" >= 0));
INSERT INTO "TariffGroup" (id,title,"nissanBaseToman","nissanPerKmToman","flatbedBaseToman","flatbedPerKmToman",version) VALUES ('GROUP_1','گروه اول',1600000,60000,2000000,75000,'reference-table-v1');
INSERT INTO "TariffGroup" (id,title,"nissanBaseToman","nissanPerKmToman","flatbedBaseToman","flatbedPerKmToman",version) VALUES ('GROUP_2','گروه دوم',2000000,75000,2800000,100000,'reference-table-v1');
INSERT INTO "TariffGroup" (id,title,"nissanBaseToman","nissanPerKmToman","flatbedBaseToman","flatbedPerKmToman",version) VALUES ('GROUP_3','گروه سوم',2600000,85000,4000000,120000,'reference-table-v1');
INSERT INTO "TariffGroup" (id,title,"nissanBaseToman","nissanPerKmToman","flatbedBaseToman","flatbedPerKmToman",version) VALUES ('GROUP_4','گروه چهارم',3000000,100000,5000000,145000,'reference-table-v1');
INSERT INTO "TariffGroup" (id,title,"nissanBaseToman","nissanPerKmToman","flatbedBaseToman","flatbedPerKmToman",version) VALUES ('GROUP_5','گروه پنجم ـ توافقی',NULL,NULL,NULL,NULL,'reference-table-v1');
INSERT INTO "TariffGroup" (id,title,"nissanBaseToman","nissanPerKmToman","flatbedBaseToman","flatbedPerKmToman",version) VALUES ('NISSAN_PICKUP','نیسان وانت/یخچال',2500000,75000,NULL,NULL,'reference-table-v1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_55cab0340c4a50ae2c3365cb','نیسان آبی','نیسانآبی',ARRAY['نیسانآبی'],'نیسانآبی','NISSAN_PICKUP');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_5884a75f46feb511d8c08d1a','نیسان وانت','نیسانوانت',ARRAY['نیسانوانت'],'نیسانوانت','NISSAN_PICKUP');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_47722f2d51dcd9473d29fe59','وانت نیسان','وانتنیسان',ARRAY['وانتنیسان'],'وانتنیسان','NISSAN_PICKUP');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_d6e1867f082e352d49b62c57','نیسان یخچال','نیسانیخچال',ARRAY['نیسانیخچال'],'نیسانیخچال','NISSAN_PICKUP');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_6cf55e2a6edca815eab1f078','زامیاد','زامیاد',ARRAY['زامیاد'],'زامیاد','NISSAN_PICKUP');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_ef1637142101d91b344e04cd','nissan pickup','nissanpickup',ARRAY['nissanpickup'],'nissanpickup','NISSAN_PICKUP');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_f82b9637697163125520ece3','بنز شاسی','بنزشاسی',ARRAY['بنزشاسی'],'بنزشاسی','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_f8a70c4e89c262c970365f69','ب ام و شاسی','باموشاسی',ARRAY['باموشاسی'],'باموشاسی','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_4217fc6eb76c29a61f022a87','بی ام و شاسی','بیاموشاسی',ARRAY['بیاموشاسی'],'بیاموشاسی','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_8083ea285ed89479648f2ad8','پرادو 6','پرادو6',ARRAY['پرادو6'],'پرادو6','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_3649220cc5cfeceaf2154a30','لندکروز','لندکروز',ARRAY['لندکروز'],'لندکروز','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_b74c0f595f1285f956c3f79a','هایلوکس','هایلوکس',ARRAY['هایلوکس'],'هایلوکس','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_16b529d98734a4f038c6ed78','پیکاپ','پیکاپ',ARRAY['پیکاپ'],'پیکاپ','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_12f4413a33f926814c51d04d','لندروور','لندروور',ARRAY['لندروور'],'لندروور','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_449753bb33958cda9b896420','جیپ','جیپ',ARRAY['جیپ'],'جیپ','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_59a611ae59720f5b8e2fbde6','سوئد خودرو','سوئدخودرو',ARRAY['سوئدخودرو'],'سوئدخودرو','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_2d488738b258fd10f7035623','دوکابین','دوکابین',ARRAY['دوکابین'],'دوکابین','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_875b959ba8de123be68962cf','دبلیوگل','دبلیوگل',ARRAY['دبلیوگل'],'دبلیوگل','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_d9c39592f2b8b53ef3478aa7','سایر خودروها','سایرخودروها',ARRAY['سایرخودروها'],'سایرخودروها','GROUP_5');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_37684731f533844812d963a0','بنز سواری','بنزسواری',ARRAY['بنزسواری'],'بنزسواری','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_96e85c74513055b4a20e6b98','بی ام و سواری','بیاموسواری',ARRAY['بیاموسواری'],'بیاموسواری','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_e8d256ed1fdb16197c90a556','ب ام و سواری','باموسواری',ARRAY['باموسواری'],'باموسواری','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_deb2b05ee5c0dc5435b2e020','سوناتا','سوناتا',ARRAY['سوناتا'],'سوناتا','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_0e5b9ff86b63ac7cd880a63b','کمری','کمری',ARRAY['کمری'],'کمری','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_4fc65e457b72e330e8408930','سانتافه','سانتافه',ARRAY['سانتافه'],'سانتافه','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_55295e4d7992e55ee002a801','کیا','کیا',ARRAY['کیا'],'کیا','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_8367ddb1e516667b19389ad1','آزرا','آزرا',ARRAY['آزرا'],'آزرا','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_b991893f63a9a5bbe47e2fab','اسپورتیج','اسپورتیج',ARRAY['اسپورتیج'],'اسپورتیج','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_0c7faaf9e3efcb91e714fe14','سورنتو','سورنتو',ARRAY['سورنتو'],'سورنتو','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_bab1f78ad132f2b95e720381','توسان','توسان',ARRAY['توسان'],'توسان','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_af326e13ed6c1f567e53647c','هیوندای شاسی','هیوندایشاسی',ARRAY['هیوندایشاسی'],'هیوندایشاسی','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_284b01fe17b440e044ae4d2d','لکسوس','لکسوس',ARRAY['لکسوس'],'لکسوس','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_620e688f2109357b2f3f1fd7','هایما','هایما',ARRAY['هایما'],'هایما','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_68cb0047d664e60aa4f8cc43','وایکینگ','وایکینگ',ARRAY['وایکینگ'],'وایکینگ','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_c6ec74af7563452ae543df3e','چانگان','چانگان',ARRAY['چانگان'],'چانگان','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_8821e851612e2f3cd15f4118','فیدلیتی','فیدلیتی',ARRAY['فیدلیتی'],'فیدلیتی','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_93a54795f70253c325b8236a','جک شاسی','جکشاسی',ARRAY['جکشاسی'],'جکشاسی','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_59fd7ea121b46ce7c72acd5e','پورشه','پورشه',ARRAY['پورشه'],'پورشه','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_4b098f4d36650936d13b5d02','برلیانس شاسی','برلیانسشاسی',ARRAY['برلیانسشاسی'],'برلیانسشاسی','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_5f3cb917f492c7f7c2921c26','جنیسیس','جنیسیس',ARRAY['جنیسیس'],'جنیسیس','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_44951182e5580324dd24c925','کوپه','کوپه',ARRAY['کوپه'],'کوپه','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_12dd84183afb5c15e4f1ea7c','ماکسیما','ماکسیما',ARRAY['ماکسیما'],'ماکسیما','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_da92d4b3b260f42ce10c0246','اپتیما','اپتیما',ARRAY['اپتیما'],'اپتیما','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_d0d4708d0b4ef03188364976','مورانو','مورانو',ARRAY['مورانو'],'مورانو','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_5d9eb92624a0f7cd4fd1c562','کولیوس','کولیوس',ARRAY['کولیوس'],'کولیوس','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_f450a8f6894f48fbca664f31','جیلی شاسی','جیلیشاسی',ARRAY['جیلیشاسی'],'جیلیشاسی','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_0c5217ad2ec1ec9d3f9b3cf6','پرادو 4','پرادو4',ARRAY['پرادو4'],'پرادو4','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_718c1e81c1afcfa967a82bc3','ون','ون',ARRAY['ون'],'ون','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_26630267daea1fda2eeb7747','سوزوکی','سوزوکی',ARRAY['سوزوکی'],'سوزوکی','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_6ab0f659359fe87fa4e7b42f','ویتارا','ویتارا',ARRAY['ویتارا'],'ویتارا','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_b86b6d77a37c72e8b2eb58bb','لندمارک','لندمارک',ARRAY['لندمارک'],'لندمارک','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_eeca7ed13041722e5b54e2a6','میتسوبیشی','میتسوبیشی',ARRAY['میتسوبیشی'],'میتسوبیشی','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_35bab8adf7600be12b5f9667','camry','camry',ARRAY['camry'],'camry','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_8d67e924fc4d24e350b9c09b','sonata','sonata',ARRAY['sonata'],'sonata','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_855a2b6a271b67d78bc98fa9','santa fe','santafe',ARRAY['santafe'],'santafe','GROUP_4');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_00e37aa82591af7f894a0ff2','مزدا 3','مزدا3',ARRAY['مزدا3','3'],'مزدا3|3','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_8b6abd6ce7b19f0fb7d02407','مزدا 2','مزدا2',ARRAY['مزدا2','2'],'مزدا2|2','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_13f4ba1f538ec9e52282e0fa','بی وای دی','بیوایدی',ARRAY['بیوایدی'],'بیوایدی','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_f25bbea0b95de9161368217f','byd','byd',ARRAY['byd'],'byd','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_e00f943179671688ecd73702','مگان','مگان',ARRAY['مگان'],'مگان','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_51acc85f49ea6e02cb51961d','اکسنت','اکسنت',ARRAY['اکسنت'],'اکسنت','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_77102b21e14b5982036893df','پژو پارس','پژوپارس',ARRAY['پژوپارس','پارس'],'پژوپارس|پارس','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_4ed177dc2c6032179d59865f','پارس','پارس',ARRAY['پارس'],'پارس','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_66209bcb1070b6dd8fdacfdf','آریا','آریا',ARRAY['آریا'],'آریا','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_00749df8f9623deb808c1fe2','شاهین','شاهین',ARRAY['شاهین'],'شاهین','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_7cd56e4ad0629b6a7621c648','سراتو','سراتو',ARRAY['سراتو'],'سراتو','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_1366864a9d02c3b1bcf2c0d9','آوانته','آوانته',ARRAY['آوانته'],'آوانته','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_67f853b6615295f1383c9dff','ام جی سواری','امجیسواری',ARRAY['امجیسواری'],'امجیسواری','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_47e89baced9df37e9b56f446','کرولا','کرولا',ARRAY['کرولا'],'کرولا','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_2829940732080926ad726b30','اپل','اپل',ARRAY['اپل'],'اپل','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_22e7094ec1722086b006c734','زانتیا','زانتیا',ARRAY['زانتیا'],'زانتیا','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_3c73b583f95da9a2959d7017','سیتروئن','سیتروئن',ARRAY['سیتروئن'],'سیتروئن','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_0e9cc2bdf4e690d9c3cf25cb','لیفان 620','لیفان620',ARRAY['لیفان620'],'لیفان620','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_f946e9681f0ac3b770bd2eb4','آلفارومئو','آلفارومئو',ARRAY['آلفارومئو'],'آلفارومئو','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_a9ad16ee8dfec0d14edf5782','برلیانس','برلیانس',ARRAY['برلیانس'],'برلیانس','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_c44b60aa5535487bed2c4611','ام وی ام ایکس 22','امویامایکس22',ARRAY['امویامایکس22'],'امویامایکس22','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_c0f918c1228d92d40b9df8c9','ایکس 22','ایکس22',ARRAY['ایکس22'],'ایکس22','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_3ae83660f67600220d1793ca','corolla','corolla',ARRAY['corolla'],'corolla','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_0efff7bff579a7db567fc8cc','mazda 3','mazda3',ARRAY['mazda3'],'mazda3','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_9e87102c2238c0a3f8b72eae','mazda 2','mazda2',ARRAY['mazda2'],'mazda2','GROUP_3');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_bb7af272b3717706dc13d0ec','مزدا 323','مزدا323',ARRAY['مزدا323','323'],'مزدا323|323','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_161759f13f43c6f6daf72b17','سمند سورن','سمندسورن',ARRAY['سمندسورن'],'سمندسورن','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_bb3d11bc693da0b710c7aecb','سورن','سورن',ARRAY['سورن'],'سورن','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_9dfcd51ed1f16e620c80695d','ساندرو','ساندرو',ARRAY['ساندرو'],'ساندرو','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_5e61418b0cf8a0009b6e93ba','ال 90','ال90',ARRAY['ال90'],'ال90','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_5932c139012cd8c1ed7fdf50','l90','l90',ARRAY['l90'],'l90','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_dcaac0471b7dfa162cd05c40','ام وی ام سواری','امویامسواری',ARRAY['امویامسواری'],'امویامسواری','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_1096bb808426958c065ca71b','دنا','دنا',ARRAY['دنا'],'دنا','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_d0659a5df76eb172cc362483','مزدا وانت','مزداوانت',ARRAY['مزداوانت','وانت'],'مزداوانت|وانت','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_3b4d921e14371bda6d23fa53','وانت مزدا','وانتمزدا',ARRAY['وانتمزدا'],'وانتمزدا','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_ed4c2c328a41683f932583e8','تندر','تندر',ARRAY['تندر'],'تندر','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_231f48fc0ba9d25573ddcfd7','وانا','وانا',ARRAY['وانا'],'وانا','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_4e9c64cb1d6cc15a4b7d078c','sandero','sandero',ARRAY['sandero'],'sandero','GROUP_2');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_59c6bee0d5441b863af70f20','پژو 404','پژو404',ARRAY['پژو404','404'],'پژو404|404','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_6d450c45bf8b4eeb5949da9c','پژو 405','پژو405',ARRAY['پژو405','405'],'پژو405|405','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_49385189cdafb6f34cf57640','پژو 206','پژو206',ARRAY['پژو206','206'],'پژو206|206','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_de1badc497917ddb56bf9f8b','پژو 207','پژو207',ARRAY['پژو207','207'],'پژو207|207','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_93edd7aecb34ae337cdc15ab','peugeot 206','peugeot206',ARRAY['peugeot206'],'peugeot206','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_6593d6cb4964663239c5361c','peugeot 207','peugeot207',ARRAY['peugeot207'],'peugeot207','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_1d2e18ebb7d6665d6f6ce968','پراید','پراید',ARRAY['پراید'],'پراید','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_4fafb02fc1a976d4642ff290','تیبا','تیبا',ARRAY['تیبا'],'تیبا','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_54fc28e7a08f68b13d7d2b90','ساینا','ساینا',ARRAY['ساینا'],'ساینا','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_e1f0590cab7280b18c448244','آردی','آردی',ARRAY['آردی'],'آردی','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_987f8241d8aa9b5c73aaa4a4','سمند','سمند',ARRAY['سمند'],'سمند','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_0fbab2a720a2ca0c93d75f51','نیسان سواری','نیسانسواری',ARRAY['نیسانسواری'],'نیسانسواری','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_508e549ed51f56c267eca0ea','آردی آی','آردیآی',ARRAY['آردیآی'],'آردیآی','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_e0a43a5c96f6ed3df321b223','پیکان','پیکان',ARRAY['پیکان'],'پیکان','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_77ad18ee04aba76e6634d45c','رانا','رانا',ARRAY['رانا'],'رانا','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_1cc33f93f9da10a8c39d191b','داتسون','داتسون',ARRAY['داتسون'],'داتسون','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_0873522c127eb549a345cc83','مزدا 929','مزدا929',ARRAY['مزدا929','929'],'مزدا929|929','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_f6914c4d8f534384916dbb99','دوو','دوو',ARRAY['دوو'],'دوو','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_a5c50d7e7f28792b00a9ffe1','کوییک','کوییک',ARRAY['کوییک'],'کوییک','GROUP_1');
INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES ('vm_d8d594e61b4aab49fb67bcdb','ریو','ریو',ARRAY['ریو'],'ریو','GROUP_1');

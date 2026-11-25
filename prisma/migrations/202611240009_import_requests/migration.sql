CREATE TABLE "ImportRequest" (
 id TEXT PRIMARY KEY,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('CARS','PARTS')),
 "fullName" TEXT NOT NULL,
 phone TEXT NOT NULL,
 city TEXT NOT NULL,
 subject TEXT NOT NULL,
 description TEXT NOT NULL,
 "partCode" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ImportRequest_createdAt_id_idx" ON "ImportRequest"("createdAt",id);
CREATE INDEX "ImportRequest_userId_idx" ON "ImportRequest"("userId");

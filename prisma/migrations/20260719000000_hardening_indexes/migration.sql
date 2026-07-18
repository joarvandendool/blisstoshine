-- Productiehardening (fase 10): uitsluitend additieve indexen op hete
-- querypaden en de retentie-opruiming. Geen kolom- of datawijzigingen.

-- Publieke vacaturelijst: WHERE status = 'published' ORDER BY "publishedAt" DESC
-- (src/server/public/queries.ts:listPublicJobs).
CREATE INDEX "Vacancy_status_publishedAt_idx" ON "Vacancy"("status", "publishedAt");

-- Cron applyScheduledChanges: niet-canceled abonnementen met verstreken
-- periode-einde (src/lib/billing/index.ts).
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- Retentie (24 mnd) plus 30-dagen-gebruiksvensters (src/server/kpi.ts:521).
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- Retentie (6 mnd): notificaties op leeftijd opruimen (src/server/privacy.ts).
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- Retentie (7 dgn): verlopen rate-limit-vensters over alle keys heen opruimen;
-- de primaire sleutel (key, windowStart) helpt daar niet bij.
CREATE INDEX "RateLimitCounter_windowStart_idx" ON "RateLimitCounter"("windowStart");

-- Retentie (18 mnd): inactieve draft-kandidaatprofielen (src/server/privacy.ts).
CREATE INDEX "CandidateProfile_status_updatedAt_idx" ON "CandidateProfile"("status", "updatedAt");

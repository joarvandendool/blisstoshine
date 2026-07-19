-- Checkout-idempotency: hooguit één niet-geannuleerd abonnement per
-- organisatie, zodat een dubbele checkout (dubbelklik/retry) geen tweede
-- actief abonnement (en onder een echte provider: dubbele afschrijving)
-- kan aanmaken.

-- 1. Bestaande duplicaten opruimen: per organisatie het nieuwste
--    niet-geannuleerde abonnement behouden, de rest annuleren.
WITH gerangschikt AS (
  SELECT id, row_number() OVER (
    PARTITION BY "organizationId" ORDER BY "createdAt" DESC
  ) AS rn
  FROM "Subscription"
  WHERE status <> 'canceled'
)
UPDATE "Subscription" s
SET status = 'canceled'
FROM gerangschikt g
WHERE s.id = g.id AND g.rn > 1;

-- 2. Afdwingen met een partiële unieke index.
CREATE UNIQUE INDEX "Subscription_actief_per_org_uniek"
  ON "Subscription"("organizationId")
  WHERE status <> 'canceled';

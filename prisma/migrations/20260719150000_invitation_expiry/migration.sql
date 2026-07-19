-- Uitnodigingen krijgen een uiterste geldigheid; na dit moment kan een
-- kandidaat de uitnodiging niet meer accepteren.
ALTER TABLE "Invitation" ADD COLUMN "expiresAt" TIMESTAMP(3);

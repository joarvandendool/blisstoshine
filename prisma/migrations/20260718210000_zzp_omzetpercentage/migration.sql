-- Behandelaren als zzp'er werken met een percentage van de omzet, niet met een uurtarief.
ALTER TABLE "CandidateProfile" RENAME COLUMN "hourlyRateMin" TO "revenueShareMin";
ALTER TABLE "Vacancy" RENAME COLUMN "hourlyRateMax" TO "revenueShareMax";

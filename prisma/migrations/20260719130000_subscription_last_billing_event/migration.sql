-- Out-of-order-bescherming voor betaalwebhooks: tijdstip van het laatst
-- verwerkte betaalstatus-event, zodat een ouder event een nieuwere status
-- niet terugdraait.
ALTER TABLE "Subscription" ADD COLUMN "lastBillingEventAt" TIMESTAMP(3);

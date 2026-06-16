-- Index campaign_recipients by providerMessageId so inbound provider webhooks
-- (delivery/read acks) can match a recipient by the provider's message id.
CREATE INDEX "campaign_recipients_providerMessageId_idx" ON "campaign_recipients"("providerMessageId");

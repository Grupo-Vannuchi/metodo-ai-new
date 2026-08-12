-- Marks an outbound message as authored by the WhatsApp AI agent, so a human
-- takeover (reply from the Inbox or the owner's own phone) can be distinguished
-- from the bot's own echoed message for handoff-by-time.
ALTER TABLE "messages" ADD COLUMN "agentReply" BOOLEAN NOT NULL DEFAULT false;

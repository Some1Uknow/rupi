-- Claim webhook inbox work durably so concurrent cron invocations never
-- process the same accepted provider event at the same time.
ALTER TABLE provider_webhook_events
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

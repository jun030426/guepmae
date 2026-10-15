-- Large, atomic market imports need longer than the inherited 8s API timeout.
-- Apply only to this service-only function; public query limits stay unchanged.
alter function public.publish_market_dataset(uuid,jsonb) set statement_timeout = '60s';

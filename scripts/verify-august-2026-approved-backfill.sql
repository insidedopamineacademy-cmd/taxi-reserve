\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH
approved(driver_id, vehicle_type, expected_amount) AS (
  VALUES
    ('cmspcry9h0026v5q6mzf0312e', 'SEDAN', 7.00::numeric),
    ('cmspcrxj1001ov5q61c8euiqu', 'VAN', 20.00::numeric),
    ('cmspcrxg7001mv5q6pp6310c8', 'SEDAN', 7.00::numeric),
    ('cmthoeujz001bld047b8web0p', 'SEDAN', 7.00::numeric),
    ('cmspcryr3002iv5q6t6d2vuks', 'SEDAN', 7.00::numeric),
    ('cmspcrxuw001wv5q6473p2gfp', 'SEDAN', 7.00::numeric),
    ('cmspcrycf0028v5q6hbkllwu8', 'VAN', 20.00::numeric),
    ('cmspcryfb002av5q6urepnq4j', 'VAN', 20.00::numeric),
    ('cmspcrwnh0016v5q63ogagznp', 'VAN', 20.00::numeric),
    ('cmspcrxs2001uv5q69lfhc0jx', 'VAN', 20.00::numeric),
    ('cmspcrx6n001gv5q6a8dt3l01', 'VAN', 20.00::numeric),
    ('cmt7jtton0003kz04ylnv4to2', 'VAN', 20.00::numeric),
    ('cmsog62nw0000l604f0rbpk1g', 'VAN', 20.00::numeric),
    ('cmspcrwii0014v5q62bq0jvxl', 'VAN', 20.00::numeric),
    ('cmspcrwb90010v5q67dh8zpfo', 'VAN', 20.00::numeric),
    ('cmspcrw47000wv5q60i7o4r5y', 'VAN', 20.00::numeric),
    ('cmtggmsps0024l40436sv4jpk', 'VAN', 20.00::numeric),
    ('cmsrtcolo0006kt04rp6klt0u', 'VAN', 20.00::numeric),
    ('cmsz43gqi000nl8045gmwhdm7', 'VAN', 20.00::numeric),
    ('cmspcrvnv000ov5q6djwnxrwp', 'VAN', 20.00::numeric),
    ('cmspcrvzn000uv5q6wkezu3v3', 'VAN', 20.00::numeric),
    ('cmspcruv20006v5q6mc3xvuo3', 'VAN', 20.00::numeric),
    ('cmspcrus30004v5q6n44e5tgg', 'VAN', 20.00::numeric),
    ('cmspcry3m0022v5q6berntr0v', 'VAN', 20.00::numeric),
    ('cmsrae7wp0000jp04g4gm58pw', 'VAN', 20.00::numeric),
    ('cmsrazjf4000sjp04j3ernvbk', 'VAN', 20.00::numeric),
    ('cmspcryo4002gv5q6j47by5v2', 'VAN', 20.00::numeric),
    ('cmspcrv7c000ev5q62a2js9cj', 'SEDAN', 7.00::numeric),
    ('cmspcrw7m000yv5q6ts3s8upg', 'VAN', 20.00::numeric),
    ('cmspcrvky000mv5q6010j6tlc', 'VAN', 20.00::numeric),
    ('cmspcrwvd001av5q6snvzqc3h', 'VAN', 20.00::numeric),
    ('cmspcrv12000av5q6lda0kxmz', 'SEDAN', 7.00::numeric),
    ('cmspcry6l0024v5q6kx8p3zhf', 'SEDAN', 7.00::numeric),
    ('cmsz3n9u7000kl1048l2x6kng', 'VAN', 20.00::numeric),
    ('cmspcrxp7001sv5q6b9adbn7p', 'VAN', 20.00::numeric),
    ('cmspcrwey0012v5q60u86o25n', 'VAN', 20.00::numeric),
    ('cmspcrwrj0018v5q6qa6oykgx', 'VAN', 20.00::numeric),
    ('cmspcrvw7000sv5q63tslsing', 'VAN', 20.00::numeric),
    ('cmsxgmhu2000il304sxc3jiof', 'SEDAN', 7.00::numeric),
    ('cmspcrxma001qv5q6lrnph9uk', 'VAN', 20.00::numeric),
    ('cmspcrxxq001yv5q6o081bcwl', 'SEDAN', 7.00::numeric),
    ('cmtgi4kzh0004jx04b7had7un', 'VAN', 20.00::numeric),
    ('cmtdijp4b000ql2042cnozzq2', 'VAN', 20.00::numeric),
    ('cmsxfs6kf001ml404mh7o3yxy', 'VAN', 20.00::numeric),
    ('cmsw9ce870003l904yda7ncbl', 'VAN', 20.00::numeric),
    ('cmspcrvs4000qv5q69dswr2fa', 'VAN', 20.00::numeric),
    ('cmspcrx9y001iv5q6fsmt82nx', 'VAN', 20.00::numeric),
    ('cmspcrvep000iv5q69z2gfnds', 'VAN', 20.00::numeric),
    ('cmspcrv46000cv5q6se0jgspn', 'VAN', 20.00::numeric),
    ('cmsxfgr5n000yl404t7cnh6ts', 'VAN', 20.00::numeric),
    ('cmspcruy00008v5q6jybbs7xp', 'VAN', 20.00::numeric),
    ('cmspcrva9000gv5q6kb8jvs05', 'VAN', 20.00::numeric),
    ('cmt0ilxbx0016jv04reufb5m7', 'VAN', 20.00::numeric),
    ('cmtggfvex001vl404fr0ir87v', 'VAN', 20.00::numeric),
    ('cmsupz0cf0008jo0485frtzqt', 'VAN', 20.00::numeric),
    ('cmspcry0m0020v5q6jhysg0l4', 'VAN', 20.00::numeric),
    ('cmspcrup00002v5q6pwjnv6a6', 'VAN', 20.00::numeric),
    ('cmt52xrw90003l804jl2x8cu2', 'VAN', 20.00::numeric),
    ('cmspv2un90000l5041dzq4qlp', 'VAN', 20.00::numeric),
    ('cmspcryla002ev5q6ordht731', 'VAN', 20.00::numeric),
    ('cmspcrx3s001ev5q6ps7x6fvv', 'VAN', 20.00::numeric),
    ('cmspcrwzu001cv5q6k2958pv1', 'VAN', 20.00::numeric),
    ('cmspcrvho000kv5q6iultbqpk', 'VAN', 20.00::numeric),
    ('cmspcrujx0000v5q6nbuejcnz', 'VAN', 20.00::numeric),
    ('cmsxgo23y000nl30456da2t7h', 'VAN', 20.00::numeric),
    ('cmspcryu1002kv5q6gtfi07or', 'SEDAN', 7.00::numeric),
    ('cmsxfckim000pl404w10zrf5c', 'VAN', 20.00::numeric),
    ('cmsxcq23g0003l404m4ypoj6a', 'VAN', 20.00::numeric),
    ('cmspcryi8002cv5q6ac9n1qe1', 'VAN', 20.00::numeric),
    ('cmspcrxcv001kv5q6c9s9xntj', 'SEDAN', 7.00::numeric)
),
clear_skip(driver_id) AS (
  VALUES
    ('cmu0pyimq0000lb04g0gqr0f0'),
    ('cmti244430002l5044tzv2eeq'),
    ('cmsm81uqp0008l40463fv78pf'),
    ('cmtnbfkyc000gl7044umza8qm'),
    ('cmtnj3ghc000ji804ajh36ufx'),
    ('cmtt0rudv000fjr041ls0ep83'),
    ('cmsmlckmu0000l7046qkuojc4'),
    ('cmtxhzlxz000klg0474gkadhz'),
    ('cmsnrez83000ljs04bfhl06qq'),
    ('cmtj1vdr10006ky04fa6gbf4s'),
    ('cmtqermbv0000jg04kf70kj3t')
),
august_charges AS (
  SELECT c.*
  FROM "DriverSubscriptionCharge" c
  WHERE c."chargeMonth" = DATE '2026-08-01'
),
approved_charges AS (
  SELECT a.driver_id, a.vehicle_type, a.expected_amount,
         c."id" AS charge_id, c."amount" AS charge_amount
  FROM approved a
  LEFT JOIN august_charges c ON c."driverId" = a.driver_id
),
approved_links AS (
  SELECT ac.driver_id, ac.vehicle_type, ac.expected_amount,
         ac.charge_id, ac.charge_amount,
         e."id" AS liability_id, e."driverId" AS liability_driver_id,
         e."commissionAmount" AS liability_amount
  FROM approved_charges ac
  LEFT JOIN "CommissionEntry" e ON e."subscriptionChargeId" = ac.charge_id
),
metrics AS (
  SELECT
    (SELECT COUNT(*) FROM approved) AS approved_expected,
    (SELECT COUNT(*) FROM approved_charges WHERE charge_id IS NOT NULL) AS approved_charge_count,
    (SELECT COUNT(*) FROM august_charges) AS all_august_charge_count,
    (SELECT COALESCE(SUM(charge_amount),0) FROM approved_charges) AS approved_charge_total,
    (SELECT COUNT(*) FROM approved_charges WHERE vehicle_type='VAN' AND charge_amount=20.00) AS van_20_count,
    (SELECT COUNT(*) FROM approved_charges WHERE vehicle_type='SEDAN' AND charge_amount=7.00) AS sedan_7_count,
    (SELECT COUNT(*) FROM approved_links
       WHERE liability_id IS NOT NULL
         AND liability_driver_id=driver_id
         AND liability_amount=expected_amount
         AND charge_amount=expected_amount) AS matching_link_count,
    (SELECT COALESCE(SUM(liability_amount),0) FROM approved_links) AS approved_liability_total,
    (SELECT COUNT(*) FROM august_charges c
       WHERE NOT EXISTS (SELECT 1 FROM approved a WHERE a.driver_id=c."driverId")) AS unexpected_august_charge_count,
    (SELECT COUNT(*) FROM clear_skip s
       JOIN august_charges c ON c."driverId"=s.driver_id) AS clear_skip_charge_count,
    (SELECT COALESCE(SUM(x.n - 1),0) FROM (
       SELECT COUNT(*) AS n FROM august_charges GROUP BY "driverId", "chargeMonth" HAVING COUNT(*) > 1
     ) x) AS duplicate_driver_month_count,
    (SELECT COALESCE(SUM(x.n - 1),0) FROM (
       SELECT COUNT(*) AS n FROM "CommissionEntry"
       WHERE "subscriptionChargeId" IS NOT NULL
       GROUP BY "subscriptionChargeId" HAVING COUNT(*) > 1
     ) x) AS duplicate_liability_link_count,
    (SELECT COUNT(*) FROM "DriverSubscriptionCharge" c
       WHERE c."chargeMonth"=DATE '2026-09-01') AS september_count,
    (SELECT COALESCE(SUM(c."amount"),0) FROM "DriverSubscriptionCharge" c
       WHERE c."chargeMonth"=DATE '2026-09-01') AS september_total,
    (SELECT md5(COALESCE(string_agg(row_to_json(c)::text, '|' ORDER BY c."id"), ''))
       FROM "DriverSubscriptionCharge" c WHERE c."chargeMonth"=DATE '2026-09-01') AS september_fingerprint,
    (SELECT COUNT(*) FROM "DriverPayment") AS payment_count,
    (SELECT COALESCE(SUM(p."amount"),0) FROM "DriverPayment" p) AS payment_total,
    (SELECT md5(COALESCE(string_agg(row_to_json(p)::text, '|' ORDER BY p."id"), '')) FROM "DriverPayment" p) AS payment_fingerprint,
    (SELECT COUNT(*) FROM "DriverSubscriptionPaymentAllocation") AS allocation_count,
    (SELECT COALESCE(SUM(a."amount"),0) FROM "DriverSubscriptionPaymentAllocation" a) AS allocation_total,
    (SELECT md5(COALESCE(string_agg(row_to_json(a)::text, '|' ORDER BY a."id"), '')) FROM "DriverSubscriptionPaymentAllocation" a) AS allocation_fingerprint,
    (SELECT COUNT(*) FROM "CommissionEntry" e WHERE e."subscriptionChargeId" IS NULL) AS preexisting_commission_count,
    (SELECT COALESCE(SUM(e."commissionAmount"),0) FROM "CommissionEntry" e WHERE e."subscriptionChargeId" IS NULL) AS preexisting_commission_total,
    (SELECT md5(COALESCE(string_agg(row_to_json(e)::text, '|' ORDER BY e."id"), ''))
       FROM "CommissionEntry" e WHERE e."subscriptionChargeId" IS NULL) AS preexisting_commission_fingerprint,
    (SELECT COUNT(*) FROM "CommissionEntry") AS all_commission_count,
    (SELECT COALESCE(SUM(e."commissionAmount"),0) FROM "CommissionEntry" e) AS all_commission_total,
    (SELECT COALESCE(SUM(e."commissionAmount"),0) FROM "CommissionEntry" e)
      - (SELECT COALESCE(SUM(p."amount"),0) FROM "DriverPayment" p) AS formula_net_balance,
    (SELECT COUNT(*) FROM "ActivityLog"
       WHERE "action"='august_2026_subscription_backfill_created'
         AND "metadata"->>'executionId'='august-2026-approved-backfill-001') AS item_audit_count,
    (SELECT COUNT(*) FROM "ActivityLog"
       WHERE "action"='august_2026_subscription_backfill_batch'
         AND "entityId"='august-2026-approved-backfill-001'
         AND "metadata"->>'executionId'='august-2026-approved-backfill-001') AS batch_audit_count
),
checks AS (
  SELECT m.*,
    (approved_expected=70) AS approved_set_is_70,
    (approved_charge_count=70 AND all_august_charge_count=70 AND unexpected_august_charge_count=0) AS charges_are_exact,
    (van_20_count=58 AND sedan_7_count=12 AND approved_charge_total=1244.00) AS rates_and_charge_total_match,
    (matching_link_count=70 AND approved_liability_total=1244.00) AS liabilities_are_exact,
    (duplicate_driver_month_count=0 AND duplicate_liability_link_count=0) AS no_duplicates,
    (clear_skip_charge_count=0) AS clear_skips_untouched,
    (september_count=58 AND september_total=1017.00 AND september_fingerprint='0a60b27de103f1362c2d513f65335a6e') AS september_unchanged,
    (payment_count=33 AND payment_total=2326.00 AND payment_fingerprint='83f7351a54e7511fc817258d53956153') AS payments_unchanged,
    (allocation_count=7 AND allocation_total=127.00 AND allocation_fingerprint='436fc9f976044c9b49877622eed962e8') AS allocations_unchanged,
    (preexisting_commission_count=378 AND preexisting_commission_total=5017.00
      AND preexisting_commission_fingerprint='95e727ddb8b0e043c57ed7f8e4065ffa'
      AND all_commission_count=448 AND all_commission_total=6261.00
      AND formula_net_balance=3935.00) AS commission_ledger_and_balance_reconcile,
    (item_audit_count=70 AND batch_audit_count=1) AS audit_trail_complete
  FROM metrics m
)
SELECT *,
  (approved_set_is_70 AND charges_are_exact AND rates_and_charge_total_match
   AND liabilities_are_exact AND no_duplicates AND clear_skips_untouched
   AND september_unchanged AND payments_unchanged AND allocations_unchanged
   AND commission_ledger_and_balance_reconcile AND audit_trail_complete) AS all_checks_pass
FROM checks;

ROLLBACK;

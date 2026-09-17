# August 2026 Driver Subscription Backfill - Read-only Audit

Audit timestamp: `2026-09-17T19:07:17.924Z`
Database transaction mode: `READ ONLY`
Production writes performed: **0**

## Architecture and September evidence

The code now models each future subscription liability with a nullable, unique `CommissionEntry.subscriptionChargeId` foreign key. The charge and liability are created atomically, and only the `CommissionEntry` changes the canonical balance.

Production currently has **58** September `DriverSubscriptionCharge` rows and the new linkage column is **not deployed** there. Those legacy rows therefore have no durable relationship to a liability entry. The old generator created classification rows only; production data cannot prove whether workers manually incorporated those amounts into unrelated commission totals. They require manual review and were not modified.

The 58 rows were created from `00:00:04Z` through `00:00:15Z` on 1 September. No `CommissionEntry` was created within five minutes of that batch and no commission note contains “subscription.” Ten later unlinked manual entries happen to have €7/€20 amounts, but amount/date matching is not authoritative, so they remain manual entries and cannot be treated as September subscription liability.

The ledger audit found 378 historical commission entries: 126 retain an authoritative reservation link and 252 do not. Of the 252 unlinked rows, 251 have manual pickup/destination snapshots and one has no route snapshot, so the PDF uses a neutral manual classification for that row and does not invent a ride.

## Fresh production summary

- Existing August charges: **0**
- Clear skips: **11**
- Manual approval required: **70**
- Already represented: **0**
- Inconsistent - do not touch: **0**
- Manual-review vehicle mix: **58 VAN / 12 SEDAN**
- Maximum unapproved August liability: **€1,244.00**
- Current gross Pending: **€3,512.00**
- Current aggregate driver credits: **€821.00**
- Projected gross Pending if every manual candidate were approved: **€4,581.00** (increase **€1,069.00**)

Current status, vehicle type, and exemption are mutable. They do not prove August eligibility. Eight post-August creations and three drivers with August exemption audit evidence are clear skips; the remaining 70 require an explicit business decision.

## Explicit review list

Projected balance adds the August amount only for manual-review candidates. It is a preview, not an approved mutation.

| Driver | Driver ID | Licence | Type | Created | August amount | Current balance | Projected balance | Evidence | Decision |
|---|---|---|---|---|---:|---:|---:|---|---|
| Abdullah Azhar | `cmspcry9h0026v5q6mzf0312e` | 752 | SEDAN | 2026-08-12 | €7.00 | -€41.00 | -€34.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Abdullah Hassan | `cmspcrxj1001ov5q61c8euiqu` | 616 | VAN | 2026-08-12 | €20.00 | €15.00 | €35.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Adil | `cmu0pyimq0000lb04g0gqr0f0` | 10445 | VAN | 2026-09-14 | €20.00 | €13.00 | €13.00 | Driver record was created after August 2026. | CLEAR SKIP |
| Ahmed | `cmspcrxg7001mv5q6pp6310c8` | VTC | SEDAN | 2026-08-12 | €7.00 | €0.00 | €7.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Alberto | `cmthoeujz001bld047b8web0p` | 2637 | SEDAN | 2026-08-31 | €7.00 | -€40.00 | -€33.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Ali Arslan | `cmspcryr3002iv5q6t6d2vuks` | 3935 | SEDAN | 2026-08-12 | €7.00 | -€60.00 | -€53.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Ali Haider 1675 | `cmspcrxuw001wv5q6473p2gfp` | 1675 | SEDAN | 2026-08-12 | €7.00 | -€7.00 | €0.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Ali Haider-Ali Khan | `cmspcrycf0028v5q6hbkllwu8` | 4916 | VAN | 2026-08-12 | €20.00 | €378.00 | €398.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Ali Khan | `cmspcryfb002av5q6urepnq4j` | 4916 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Ali Tanveer | `cmspcrwnh0016v5q63ogagznp` | 1073 | VAN | 2026-08-12 | €20.00 | €84.00 | €104.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Ali Tehreem | `cmspcrxs2001uv5q69lfhc0jx` | 5901 | VAN | 2026-08-12 | €20.00 | €17.00 | €37.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Amir | `cmti244430002l5044tzv2eeq` | 5320 | SEDAN | 2026-09-01 | €7.00 | €17.00 | €17.00 | Driver record was created after August 2026. | CLEAR SKIP |
| Aneeq Irtaza | `cmspcrx6n001gv5q6a8dt3l01` | 263 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Aqif | `cmt7jtton0003kz04ylnv4to2` | VTC | VAN | 2026-08-24 | €20.00 | €109.00 | €129.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Arslan | `cmsm81uqp0008l40463fv78pf` | 5105 | VAN | 2026-08-09 | €20.00 | €0.00 | €0.00 | August audit trail proves subscription exemption was set during August 2026. | CLEAR SKIP |
| Asim | `cmsog62nw0000l604f0rbpk1g` | 6193 | VAN | 2026-08-11 | €20.00 | €41.00 | €61.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Awais Muhammad | `cmspcrwii0014v5q62bq0jvxl` | VTC | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Babar | `cmtnbfkyc000gl7044umza8qm` | VTC | VAN | 2026-09-04 | €20.00 | €70.00 | €70.00 | Driver record was created after August 2026. | CLEAR SKIP |
| Baqer- Mohsin | `cmspcrwb90010v5q67dh8zpfo` | 5986 | VAN | 2026-08-12 | €20.00 | -€20.00 | €0.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Basheer Ahmed | `cmspcrw47000wv5q60i7o4r5y` | 5181 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Bashir - A.Huraira Vtc | `cmtnj3ghc000ji804ajh36ufx` | 7255NKY | SEDAN | 2026-09-04 | €7.00 | €35.00 | €35.00 | Driver record was created after August 2026. | CLEAR SKIP |
| Bilal | `cmtggmsps0024l40436sv4jpk` | 511 | VAN | 2026-08-30 | €20.00 | €42.00 | €62.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Bilawal | `cmsrtcolo0006kt04rp6klt0u` | 9325 | VAN | 2026-08-13 | €20.00 | €101.00 | €121.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Dilawar | `cmsz43gqi000nl8045gmwhdm7` | 1737 | VAN | 2026-08-18 | €20.00 | €117.00 | €137.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Eathsham Saadat | `cmspcrvnv000ov5q6djwnxrwp` | 4579 | VAN | 2026-08-12 | €20.00 | €24.00 | €44.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Ehsam | `cmspcrvzn000uv5q6wkezu3v3` | 5181 | VAN | 2026-08-12 | €20.00 | €73.00 | €93.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Farrakh Sahi | `cmspcruv20006v5q6mc3xvuo3` | 3071 | VAN | 2026-08-12 | €20.00 | -€53.00 | -€33.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Hamid | `cmspcrus30004v5q6n44e5tgg` | VTC | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Hamza | `cmspcry3m0022v5q6berntr0v` | 6280 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Haroon | `cmsrae7wp0000jp04g4gm58pw` | 3455 | VAN | 2026-08-13 | €20.00 | €153.00 | €173.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Ibrahim | `cmsrazjf4000sjp04j3ernvbk` | 4491 | VAN | 2026-08-13 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Imran Khan | `cmspcryo4002gv5q6j47by5v2` | 9288 | VAN | 2026-08-12 | €20.00 | €5.00 | €25.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Inder | `cmspcrv7c000ev5q62a2js9cj` | 3135 | SEDAN | 2026-08-12 | €7.00 | €95.00 | €102.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Jabran-Majid | `cmspcrw7m000yv5q6ts3s8upg` | 10942 | VAN | 2026-08-12 | €20.00 | €137.00 | €157.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Javier | `cmtt0rudv000fjr041ls0ep83` | 2637 | SEDAN | 2026-09-08 | €7.00 | €0.00 | €0.00 | Driver record was created after August 2026. | CLEAR SKIP |
| Joshua Decano | `cmspcrvky000mv5q6010j6tlc` | 10427 | VAN | 2026-08-12 | €20.00 | €8.00 | €28.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Junaid Gondal | `cmspcrwvd001av5q6snvzqc3h` | 10278 | VAN | 2026-08-12 | €20.00 | -€12.00 | €8.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Karan | `cmspcrv12000av5q6lda0kxmz` | 3381 | SEDAN | 2026-08-12 | €7.00 | €6.00 | €13.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Mehboob Shahbaz | `cmspcry6l0024v5q6kx8p3zhf` | 5276 | SEDAN | 2026-08-12 | €7.00 | €6.00 | €13.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Mehroz-Albert | `cmsz3n9u7000kl1048l2x6kng` | . | VAN | 2026-08-18 | €20.00 | €122.00 | €142.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Moeez | `cmsmlckmu0000l7046qkuojc4` | 6052 | SEDAN | 2026-08-10 | €7.00 | -€362.00 | -€362.00 | August audit trail proves subscription exemption was set during August 2026. | CLEAR SKIP |
| Mohsan Ghakhr | `cmspcrxp7001sv5q6b9adbn7p` | 9175 | VAN | 2026-08-12 | €20.00 | €5.00 | €25.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Mohsin Malik | `cmspcrwey0012v5q60u86o25n` | 5986 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Moiz | `cmspcrwrj0018v5q6qa6oykgx` | 1073 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Moiz Asghar | `cmtxhzlxz000klg0474gkadhz` | 1015 | SEDAN | 2026-09-11 | €7.00 | €0.00 | €0.00 | Driver record was created after August 2026. | CLEAR SKIP |
| Muhammad Ibrahim | `cmspcrvw7000sv5q63tslsing` | 4491 | VAN | 2026-08-12 | €20.00 | -€28.00 | -€8.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Muhammad Salman | `cmsxgmhu2000il304sxc3jiof` | 6136 | SEDAN | 2026-08-17 | €7.00 | €24.00 | €31.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Muhammad Umer | `cmspcrxma001qv5q6lrnph9uk` | 9175 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Muhammad Zain | `cmspcrxxq001yv5q6o081bcwl` | 1675 | SEDAN | 2026-08-12 | €7.00 | €0.00 | €7.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Muneeb | `cmsnrez83000ljs04bfhl06qq` | VTC | VAN | 2026-08-10 | €20.00 | €109.00 | €109.00 | August audit trail proves subscription exemption was set during August 2026. | CLEAR SKIP |
| Nabeel - Zain | `cmtgi4kzh0004jx04b7had7un` | 9385 | VAN | 2026-08-31 | €20.00 | €5.00 | €25.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Nadeem | `cmtdijp4b000ql2042cnozzq2` | 8701 | VAN | 2026-08-28 | €20.00 | €17.00 | €37.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Nafees | `cmsxfs6kf001ml404mh7o3yxy` | 20001 | VAN | 2026-08-17 | €20.00 | -€118.00 | -€98.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Nibi | `cmtj1vdr10006ky04fa6gbf4s` | VTC | VAN | 2026-09-01 | €20.00 | €63.00 | €63.00 | Driver record was created after August 2026. | CLEAR SKIP |
| Noman | `cmsw9ce870003l904yda7ncbl` | 292 | VAN | 2026-08-16 | €20.00 | €70.00 | €90.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Noman Saadat | `cmspcrvs4000qv5q69dswr2fa` | 4579 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Nomy | `cmspcrx9y001iv5q6fsmt82nx` | 749 | VAN | 2026-08-12 | €20.00 | -€15.00 | €5.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Pmr Inderpreet | `cmtqermbv0000jg04kf70kj3t` | 773 | VAN | 2026-09-06 | €20.00 | €43.00 | €43.00 | Driver record was created after August 2026. | CLEAR SKIP |
| Qaisar Cheema-Sukh Sidhu | `cmspcrvep000iv5q69z2gfnds` | 8268 | VAN | 2026-08-12 | €20.00 | €5.00 | €25.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Raja Adnan | `cmspcrv46000cv5q6se0jgspn` | 8717 | VAN | 2026-08-12 | €20.00 | €55.00 | €75.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Raja Aqib | `cmsxfgr5n000yl404t7cnh6ts` | 159 | VAN | 2026-08-17 | €20.00 | €45.00 | €65.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Raja Hadeed | `cmspcruy00008v5q6jybbs7xp` | 5063 | VAN | 2026-08-12 | €20.00 | €134.00 | €154.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Raja Talha | `cmspcrva9000gv5q6kb8jvs05` | 1831 | VAN | 2026-08-12 | €20.00 | €105.00 | €125.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Raza Baig | `cmt0ilxbx0016jv04reufb5m7` | 3132 | VAN | 2026-08-19 | €20.00 | €36.00 | €56.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Rizwan | `cmtggfvex001vl404fr0ir87v` | 7093 | VAN | 2026-08-30 | €20.00 | €181.00 | €201.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Sahib | `cmsupz0cf0008jo0485frtzqt` | 2272 | VAN | 2026-08-15 | €20.00 | €91.00 | €111.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Salah | `cmspcry0m0020v5q6jhysg0l4` | 6280 | VAN | 2026-08-12 | €20.00 | -€45.00 | -€25.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Sameer Khan | `cmspcrup00002v5q6pwjnv6a6` | 10445 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Sami - Attiq | `cmt52xrw90003l804jl2x8cu2` | 3721 | VAN | 2026-08-23 | €20.00 | €46.00 | €66.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Shafqat | `cmspv2un90000l5041dzq4qlp` | .7153 | VAN | 2026-08-12 | €20.00 | €41.00 | €61.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Sheroon Akram | `cmspcryla002ev5q6ordht731` | 255 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Soban-Aniq | `cmspcrx3s001ev5q6ps7x6fvv` | 263 | VAN | 2026-08-12 | €20.00 | €9.00 | €29.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Sohail Gondal | `cmspcrwzu001cv5q6k2958pv1` | 10278 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Sukh Sidhu | `cmspcrvho000kv5q6iultbqpk` | 8268 | VAN | 2026-08-12 | €20.00 | €0.00 | €20.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Tamoor Gondal | `cmspcrujx0000v5q6nbuejcnz` | 0420MVW | VAN | 2026-08-12 | €20.00 | €325.00 | €345.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Touseef | `cmsxgo23y000nl30456da2t7h` | VTC | VAN | 2026-08-17 | €20.00 | €160.00 | €180.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Usman Ali | `cmspcryu1002kv5q6gtfi07or` | 4512 | SEDAN | 2026-08-12 | €7.00 | €0.00 | €7.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Usman-Kamran | `cmsxfckim000pl404w10zrf5c` | 5458 | VAN | 2026-08-17 | €20.00 | -€20.00 | €0.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Waleed | `cmsxcq23g0003l404m4ypoj6a` | 1737 | VAN | 2026-08-17 | €20.00 | €42.00 | €62.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Zafar Mehdi-Sheroon | `cmspcryi8002cv5q6ac9n1qe1` | 255 | VAN | 2026-08-12 | €20.00 | €107.00 | €127.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |
| Zohaib | `cmspcrxcv001kv5q6c9s9xntj` | VTC | SEDAN | 2026-08-12 | €7.00 | €126.00 | €133.00 | No durable August eligibility snapshot exists; current status/type cannot prove historical eligibility. | MANUAL APPROVAL REQUIRED |

## Commands and safeguards

Read-only preview:

```bash
npm run backfill:subscriptions:august-2026
```

Future apply syntax after the migration is deployed and an administrator has approved exact rows:

```bash
npm run backfill:subscriptions:august-2026 -- --apply \
  --actor-email=admin@example.com \
  --execution-id=august-2026-review-001 \
  --approve=<driver-id>:VAN:20.00 \
  --approve=<driver-id>:SEDAN:7.00
```

There is no `--apply-all`. Apply validates every ID, vehicle type, amount, decision category, active administrator, migration presence, and execution ID inside one serializable transaction. It creates one charge plus one linked liability and an audit record per approved driver. Any conflict rolls back the batch.

No payment or payment-allocation record is created, updated, deleted, or redistributed. New approved August charges begin with the established unpaid status and existing allocations remain untouched.

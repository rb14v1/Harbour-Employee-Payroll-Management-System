# Runbook: Database Backup and Point-in-Time Restore (PITR)

**System:** employee-payroll-hij  
**Database:** Azure Cosmos DB (MongoDB API) — `cosmosmongo-employee-payroll-hij`  
**Backup type:** Continuous / `Continuous30Days` (configured in `terraform/main.tf`)  
**Retention window:** 30 days (rolling)  
**Recovery point objective (RPO):** ~1 second within the 30-day window  
**Recovery time objective (RTO):** Typically 1–4 hours depending on database size  
**Backup storage:** Geo-redundant — replicated to the secondary region defined in `var.backup_location`

---

## 1. How backups work

Azure Cosmos DB Continuous backup captures a stream of every write (insert, update, delete, index change) and stores it in geo-redundant blob storage in both the primary and secondary regions. No manual snapshots are needed and no backup windows exist. Any timestamp within the last 30 days can be used as a restore target.

---

## 2. Before you restore

| Check | Action |
|---|---|
| Is this a production incident? | Page the on-call engineer and open an incident ticket first. |
| Is the primary database still writable? | **Stop all writers before restoring** — the application must be put into maintenance mode or scaled to 0 replicas. Restoring over a live database risks data divergence. |
| Does the target timestamp predate a finalised payroll batch? | A restore must not resurrect a batch in an earlier state after payments were released (see [database-design.md](../database-design.md) — immutability rules). Confirm the target timestamp with the Payroll Administrator. |
| Is the restore to a **new** account? | Azure PITR always restores into a **new** Cosmos DB account; it does not overwrite the existing account. Update the application's `MONGODB_URI` after the restore completes. |

---

## 3. Restore procedure

### 3.1 Identify the restore timestamp

Choose a UTC timestamp within the last 30 days. You can inspect audit logs in the `auditlogs` collection or the Azure Portal activity log to find the last known-good state.

```bash
# Example: find the timestamp of the last successful payroll finalisation
# (run against the live database before scaling down writers)
mongosh "$MONGODB_URI" --eval \
  'db.auditlogs.find({ action: "payroll.finalize" }).sort({ createdAt: -1 }).limit(5).pretty()'
```

### 3.2 Restore via Azure Portal

1. Open the **Azure Portal** → **Azure Cosmos DB** → `cosmosmongo-employee-payroll-hij`.
2. In the left menu select **Point In Time Restore**.
3. Choose **Restore point** — enter the UTC timestamp identified above.
4. Enter a new **Account name** for the restore target (e.g. `cosmosmongo-payroll-restore-YYYYMMDD`).
5. Choose the **Restore region** (use the secondary region if the primary region is unavailable).
6. Click **Restore** and wait for the operation to complete (monitor under **Notifications**).

### 3.3 Restore via Azure CLI

```bash
RESTORE_TIMESTAMP="2026-10-28T14:30:00Z"   # UTC — adjust to your target
SOURCE_ACCOUNT="cosmosmongo-employee-payroll-hij"
TARGET_ACCOUNT="cosmosmongo-payroll-restore-$(date +%Y%m%d)"
RESOURCE_GROUP="<your-resource-group>"
LOCATION="<primary-region>"

az cosmosdb restore \
  --target-database-account-name "$TARGET_ACCOUNT" \
  --account-name "$SOURCE_ACCOUNT" \
  --restore-timestamp "$RESTORE_TIMESTAMP" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION"

# Monitor restore status
az cosmosdb show \
  --name "$TARGET_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query "restoreParameters"
```

### 3.4 Verify the restored database

```bash
# Connect to the restored account and spot-check key collections
RESTORED_URI="<connection-string-for-restored-account>"

mongosh "$RESTORED_URI" --eval '
  print("organizations:", db.organizations.countDocuments());
  print("payrollperiods:", db.payrollperiods.countDocuments());
  print("payrollentries:", db.payrollentries.countDocuments());
  print("auditlogs:", db.auditlogs.countDocuments());
  db.payrollperiods.find({ status: "reconciled" }).sort({ finalizedAt: -1 }).limit(3).pretty();
'
```

Confirm:
- Document counts are plausible for the restore timestamp.
- No finalised batch appears in an earlier (`draft`, `calculated`, etc.) state.
- Audit log is intact up to the restore point.

### 3.5 Cut over the application

1. Update the `MONGODB_URI` secret in your secret manager to point to the restored account's connection string.
2. Scale up the application replicas (or disable maintenance mode).
3. Run `GET /ready` on the API and confirm it returns `200`.
4. Notify the Payroll Administrator to verify the most recent payroll period state matches expectations.

### 3.6 Clean up

After a successful cutover and sign-off, delete the **old** (corrupted/unusable) Cosmos DB account:

```bash
az cosmosdb delete \
  --name "$SOURCE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --yes
```

Rename or tag the restored account to become the new production account (or run `terraform apply` with updated names to bring it under IaC management again).

---

## 4. Pre-go-live restore test (mandatory)

This test must be completed and signed off **before** the first production payroll run.

| Step | Owner | Done |
|---|---|---|
| 1. Seed the staging database with synthetic payroll data for at least one full cycle. | Platform Engineer | ☐ |
| 2. Record the timestamp after the last finalised payroll period in staging. | Platform Engineer | ☐ |
| 3. Introduce a deliberate data mutation (e.g. update one payrollentry document). | Platform Engineer | ☐ |
| 4. Perform PITR to the timestamp from step 2 (§ 3.2 or § 3.3). | Platform Engineer | ☐ |
| 5. Run the verification queries from § 3.4 against the restored account. | Platform Engineer | ☐ |
| 6. Confirm the mutated document is absent (restore point is before the mutation). | Payroll Administrator | ☐ |
| 7. Start the API against the restored account and confirm `GET /ready` → 200. | Platform Engineer | ☐ |
| 8. Document the restore duration and any issues encountered. | Platform Engineer | ☐ |
| 9. Sign off and archive this checklist in the incident/change record. | Engineering Lead | ☐ |

---

## 5. Regular backup health checks

| Frequency | Check | How |
|---|---|---|
| Weekly | Confirm backup status is `Online` | Azure Portal → Cosmos DB account → **Backups** tab |
| Monthly | Verify geo-replication lag is < 1 minute | Azure Monitor → `ReplicationLatency` metric for the account |
| Quarterly | Perform a PITR test restore to a non-production account (§ 4) | Platform Engineer |

---

## 6. Related documents

- [Deployment guide](../deployment.md) — production checklist item 1 (backups)
- [Database design](../database-design.md) — retention and archival policy, transaction boundaries
- [Terraform configuration](../../terraform/main.tf) — `backup` block on `azurerm_cosmosdb_account.payroll`

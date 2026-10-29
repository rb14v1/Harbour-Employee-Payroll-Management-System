###############################################################################
# employee-payroll-hij — Azure Cosmos DB (MongoDB API) with automated backups
###############################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.110"
    }
  }
}

provider "azurerm" {
  features {}
}

# ---------------------------------------------------------------------------
# Variables — override in terraform.tfvars or via environment variables
# ---------------------------------------------------------------------------

variable "resource_group_name" {
  type        = string
  description = "Resource group that contains the Cosmos DB account."
}

variable "location" {
  type        = string
  description = "Primary Azure region for the Cosmos DB account."
}

variable "backup_location" {
  type        = string
  description = "Secondary Azure region where continuous-backup data is geo-replicated. Must differ from var.location."
}

# ---------------------------------------------------------------------------
# Cosmos DB account — MongoDB API, continuous backup, geo-redundant storage
# ---------------------------------------------------------------------------

resource "azurerm_cosmosdb_account" "payroll" {
  name                = "cosmosmongo-employee-payroll-hij"
  resource_group_name = var.resource_group_name
  location            = var.location

  offer_type = "Standard"
  kind       = "MongoDB"

  # Geo-redundant backup storage: primary write region + secondary read region.
  # The secondary region hosts the continuous-backup replica so that a single
  # regional outage does not take down both the live database and its backups.
  geo_location {
    location          = var.location
    failover_priority = 0
  }

  geo_location {
    location          = var.backup_location
    failover_priority = 1
  }

  # Continuous backup — 30-day retention with point-in-time recovery (PITR).
  # Restore granularity is 1 second within the 30-day window.
  # See docs/runbooks/backup-restore.md for the tested restore procedure.
  backup {
    type = "Continuous"
    tier = "Continuous30Days"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  mongo_server_version = "7.0"

  # Ensure data at rest is encrypted (platform-managed key by default).
  # Replace with a Customer-Managed Key (CMK) for stricter compliance.
  is_virtual_network_filter_enabled = false
}

variable "vdc" {
  type        = string
  description = "Org VDC containing the lab vApps (TF_VAR_vdc in .env)."
}

variable "vapp_name" {
  type        = string
  description = "Existing vApp to manage. Imported, not created, by this config (TF_VAR_vapp_name in .env)."
}

variable "power_on" {
  type        = bool
  description = "Desired power state of the vApp."
  default     = false
}

variable "vcd_url" {
  type        = string
  description = "Tenant API endpoint, https://<vcd-host>/api (TF_VAR_vcd_url in .env)."
}

variable "vcd_org" {
  type        = string
  description = "Organization name (TF_VAR_vcd_org in .env)."
}

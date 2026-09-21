# All values come from TF_VAR_* in .env (loaded by scripts/tf.sh or the service).
variable "vdc" { type = string }
variable "vcd_url" { type = string }
variable "vcd_org" { type = string }
variable "org_network" {
  description = "Routed Org VDC network the lab gateway uplinks to."
  type        = string
}
variable "catalog" {
  description = "Catalog holding the golden images."
  type        = string
}
variable "power_on" {
  type    = bool
  default = false
}
variable "guest_customization" {
  type    = bool
  default = false
}
